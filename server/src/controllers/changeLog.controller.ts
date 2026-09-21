import type { Request, Response } from "express";
import { z } from "zod";
import { listChangeLog } from "../services/changeLog.service";
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
