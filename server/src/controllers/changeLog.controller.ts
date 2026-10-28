import type { Request, Response } from "express";
import { z } from "zod";
import {
  DEFAULT_CHANGE_LOG_LIMIT,
  MAX_CHANGE_LOG_LIMIT,
  exportChangeLogCsv,
  getCellHistory,
  getRecentlyChangedCells,
  isCellHistoryTable,
  listChangeLog,
} from "../services/changeLog.service";
import { HttpError } from "../utils/HttpError";
import { env } from "../config/env";
import { listArchive, runArchive } from "../services/changeLogArchive.service";
import { getSheetVersion, listPublishHistory, listSheetVersions } from "../services/sheetHistory.service";
import { restoreSheetVersion } from "../services/sheetRestore.service";

const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;

/// "2026-10-09" or a full ISO timestamp. A date-only dateTo means that whole
/// day (inclusive); the page sends local-time timestamps so its "day" matches
/// the one the user sees.
function dateParam(edge: "from" | "to") {
  return z
    .string()
    .refine((v) => (DATE_ONLY.test(v) ? true : !Number.isNaN(Date.parse(v))), "Invalid date")
    .transform((v) => {
      if (!DATE_ONLY.test(v)) return new Date(v);
      return new Date(`${v}T${edge === "from" ? "00:00:00.000" : "23:59:59.999"}Z`);
    });
}

const filterSchema = z.object({
  tableName: z.string().min(1).optional(),
  recordId: z.coerce.number().int().positive().optional(),
  dateFrom: dateParam("from").optional(),
  dateTo: dateParam("to").optional(),
  userId: z.coerce.number().int().positive().optional(),
  action: z.enum(["CREATE", "UPDATE", "DELETE"]).optional(),
  productId: z.coerce.number().int().positive().optional(),
  shift: z.enum(["MORNING", "NIGHT"]).optional(),
  reportType: z.enum(["Daily Report", "Variance Report", "Audit Report", "Daily Out"]).optional(),
  reportSection: z.enum(["online", "offline", "all"]).optional(),
  importOnly: z.enum(["true", "false"]).transform((v) => v === "true").optional(),
});

const pageSchema = filterSchema.extend({
  limit: z.coerce.number().int().positive().max(MAX_CHANGE_LOG_LIMIT).default(DEFAULT_CHANGE_LOG_LIMIT),
  cursor: z.coerce.number().int().positive().optional(),
  // Numbered paging: skip this many newest rows, and say how many match in all.
  offset: z.coerce.number().int().min(0).max(1_000_000).optional(),
  withTotal: z.enum(["true", "false"]).transform((v) => v === "true").optional(),
});

export async function getChangeLog(req: Request, res: Response) {
  const parsed = pageSchema.safeParse(req.query);
  if (!parsed.success) throw HttpError.badRequest("Invalid change log query", parsed.error.flatten());
  const { limit, cursor, offset, withTotal, ...filters } = parsed.data;
  res.json(await listChangeLog(filters, { limit, cursor, offset, withTotal }));
}

/// The same filters as the list (paging ignored), as a CSV download.
export async function exportChangeLog(req: Request, res: Response) {
  const parsed = filterSchema.safeParse(req.query);
  if (!parsed.success) throw HttpError.badRequest("Invalid change log query", parsed.error.flatten());
  const csv = await exportChangeLogCsv(parsed.data);
  res.setHeader("Content-Type", "text/csv; charset=utf-8");
  const d = new Date();
  const stamp = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  res.setHeader("Content-Disposition", `attachment; filename="change-log-${stamp}.csv"`);
  res.send(csv);
}

/// Default/max for the per-cell history list. Ten is what the popover shows;
/// the cap stops the endpoint being used to walk a whole audit trail through
/// a route that encoders can reach.
const DEFAULT_HISTORY_LIMIT = 10;
const MAX_HISTORY_LIMIT = 50;

const cellHistorySchema = z.object({
  tableName: z.string().min(1),
  recordId: z.coerce.number().int().positive(),
  field: z.string().min(1).max(64),
  limit: z.coerce.number().int().positive().max(MAX_HISTORY_LIMIT).default(DEFAULT_HISTORY_LIMIT),
});

export async function getCellHistoryHandler(req: Request, res: Response) {
  const parsed = cellHistorySchema.safeParse(req.query);
  if (!parsed.success) throw HttpError.badRequest("Invalid cell history query", parsed.error.flatten());
  // Checked here rather than as a zod enum so the refusal reads as a
  // permission problem, which is what it is - change_log also covers tables
  // (users, products, import batches) this route deliberately can't reach.
  if (!isCellHistoryTable(parsed.data.tableName)) {
    throw HttpError.forbidden("Cell history is only available for the stock entry grids");
  }
  res.json(await getCellHistory(parsed.data));
}

const recentCellsSchema = z.object({
  tableName: z.string().min(1),
  recordIds: z.string().regex(/^\d+(,\d+)*$/).transform((v) => v.split(",").map(Number)),
});

export async function getRecentCellsHandler(req: Request, res: Response) {
  const parsed = recentCellsSchema.safeParse(req.query);
  if (!parsed.success) throw HttpError.badRequest("Invalid recent cells query", parsed.error.flatten());
  if (!isCellHistoryTable(parsed.data.tableName)) {
    throw HttpError.forbidden("Recent cells are only available for the stock entry grids");
  }
  // A sheet is a few hundred products at most; the cap just bounds the IN list.
  res.json(await getRecentlyChangedCells(parsed.data.tableName, parsed.data.recordIds.slice(0, 2000)));
}

const archiveQuerySchema = z.object({
  limit: z.coerce.number().int().positive().max(MAX_CHANGE_LOG_LIMIT).default(DEFAULT_CHANGE_LOG_LIMIT),
  offset: z.coerce.number().int().min(0).max(1_000_000).optional(),
  tableName: z.string().min(1).optional(),
  recordId: z.coerce.number().int().positive().optional(),
});

export async function getArchive(req: Request, res: Response) {
  const parsed = archiveQuerySchema.safeParse(req.query);
  if (!parsed.success) throw HttpError.badRequest("Invalid archive query", parsed.error.flatten());
  res.json({ ...(await listArchive(parsed.data)), retentionMonths: env.changeLogRetentionMonths });
}

const runSchema = z.object({ months: z.coerce.number().int().min(1).max(120).optional() });

export async function postArchiveRun(req: Request, res: Response) {
  const parsed = runSchema.safeParse(req.body ?? {});
  if (!parsed.success) throw HttpError.badRequest("Invalid archive request", parsed.error.flatten());
  const months = parsed.data.months ?? (env.changeLogRetentionMonths || 12);
  res.json(await runArchive(months, req.user?.id));
}

const sheetSchema = z.object({
  sheet: z.enum(["online", "offline", "manual"]),
  date: z.string().regex(DATE_ONLY),
  shift: z.enum(["MORNING", "NIGHT"]),
});

export async function getSheetVersions(req: Request, res: Response) {
  const parsed = sheetSchema.safeParse(req.query);
  if (!parsed.success) throw HttpError.badRequest("Invalid version history query", parsed.error.flatten());
  const { sheet, date, shift } = parsed.data;
  res.json({ versions: await listSheetVersions(sheet, date, shift) });
}

export async function getSheetVersionRows(req: Request, res: Response) {
  const parsed = sheetSchema
    .extend({ upTo: z.coerce.number().int().positive(), after: z.coerce.number().int().min(0).default(0) })
    .safeParse(req.query);
  if (!parsed.success) throw HttpError.badRequest("Invalid version query", parsed.error.flatten());
  const { sheet, date, shift, upTo, after } = parsed.data;
  res.json(await getSheetVersion(sheet, date, shift, upTo, after));
}

export async function getSheetPublishHistory(req: Request, res: Response) {
  const parsed = sheetSchema.omit({ sheet: true }).safeParse(req.query);
  if (!parsed.success) throw HttpError.badRequest("Invalid publish history query", parsed.error.flatten());
  res.json({ publishes: await listPublishHistory(parsed.data.date, parsed.data.shift) });
}

const restoreSchema = sheetSchema.extend({
  sheet: z.enum(["online", "offline"]),
  upTo: z.number().int().positive(),
});

/// Puts an Online/Offline sheet back the way it stood at one version. The
/// Manual Count sheet is not restorable here: its counts carry a publish state
/// (and may already be next period's opening stock) that a replay cannot undo.
export async function postRestoreSheetVersion(req: Request, res: Response) {
  const parsed = restoreSchema.safeParse(req.body);
  if (!parsed.success) throw HttpError.badRequest("Invalid restore request", parsed.error.flatten());
  const { sheet, date, shift, upTo } = parsed.data;
  res.json(await restoreSheetVersion(sheet, date, shift, upTo, req.user?.id));
}
