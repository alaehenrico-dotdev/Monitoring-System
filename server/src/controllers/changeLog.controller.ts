import type { Request, Response } from "express";
import { z } from "zod";
import { getCellHistory, isCellHistoryTable, listChangeLog } from "../services/changeLog.service";
import { HttpError } from "../utils/HttpError";

const querySchema = z.object({
  tableName: z.string().min(1).optional(),
  recordId: z.coerce.number().int().positive().optional(),
});

export async function getChangeLog(req: Request, res: Response) {
  const parsed = querySchema.safeParse(req.query);
  if (!parsed.success) throw HttpError.badRequest("Invalid change log query", parsed.error.flatten());
  res.json(await listChangeLog(parsed.data));
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
