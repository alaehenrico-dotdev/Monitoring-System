import type { Request, Response } from "express";
import { listChangeLog } from "../services/changeLog.service";

export async function getChangeLog(req: Request, res: Response) {
  const tableName = typeof req.query.tableName === "string" ? req.query.tableName : undefined;
  const recordId = req.query.recordId ? Number(req.query.recordId) : undefined;
  const entries = await listChangeLog({ tableName, recordId });
  res.json(entries);
}
