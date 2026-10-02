import type { Request, Response } from "express";
import { z } from "zod";
import { HttpError } from "../utils/HttpError";
import { listReportHistory, recordReportHistory } from "../services/reportHistory.service";

const createSchema = z.object({
  type: z.string().min(1).max(50),
  scope: z.string().min(1).max(100),
  route: z.string().min(1).max(500),
});

export async function postReportHistory(req: Request, res: Response) {
  const parsed = createSchema.safeParse(req.body);
  if (!parsed.success) throw HttpError.badRequest("Invalid report history entry", parsed.error.flatten());

  const entry = await recordReportHistory(parsed.data, req.user?.id);
  res.status(201).json(entry);
}

export async function getReportHistory(req: Request, res: Response) {
  const type = typeof req.query.type === "string" ? req.query.type : undefined;
  res.json(await listReportHistory(type));
}
