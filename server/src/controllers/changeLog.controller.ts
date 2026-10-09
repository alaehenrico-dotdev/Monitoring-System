import type { Request, Response } from "express";
import { z } from "zod";
import {
  DEFAULT_CHANGE_LOG_LIMIT,
  MAX_CHANGE_LOG_LIMIT,
  exportChangeLogCsv,
  getCellHistory,
  isCellHistoryTable,
  listChangeLog,
} from "../services/changeLog.service";
import { HttpError } from "../utils/HttpError";

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
  reportType: z.enum(["Daily Report", "Variance Report", "Audit Report"]).optional(),
  reportSection: z.enum(["online", "offline", "all"]).optional(),
  importOnly: z.enum(["true", "false"]).transform((v) => v === "true").optional(),
});

const pageSchema = filterSchema.extend({
  limit: z.coerce.number().int().positive().max(MAX_CHANGE_LOG_LIMIT).default(DEFAULT_CHANGE_LOG_LIMIT),
  cursor: z.coerce.number().int().positive().optional(),
});

export async function getChangeLog(req: Request, res: Response) {
  const parsed = pageSchema.safeParse(req.query);
  if (!parsed.success) throw HttpError.badRequest("Invalid change log query", parsed.error.flatten());
  const { limit, cursor, ...filters } = parsed.data;
  res.json(await listChangeLog(filters, { limit, cursor }));
}

/// The same filters as the list (paging ignored), as a CSV download.
export async function exportChangeLog(req: Request, res: Response) {
  const parsed = filterSchema.safeParse(req.query);
  if (!parsed.success) throw HttpError.badRequest("Invalid change log query", parsed.error.flatten());
  const csv = await exportChangeLogCsv(parsed.data);
  res.setHeader("Content-Type", "text/csv; charset=utf-8");
  res.setHeader("Content-Disposition", 'attachment; filename="change-log.csv"');
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
