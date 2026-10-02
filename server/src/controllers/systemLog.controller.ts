import type { Request, Response } from "express";
import { z } from "zod";
import { HttpError } from "../utils/HttpError";
import { listSystemLog, recordSystemLog } from "../services/systemLog.service";

const createSchema = z.object({
  event: z.string().min(1).max(50),
  fromVersion: z.string().min(1).max(50),
  toVersion: z.string().min(1).max(50),
});

export async function postSystemLog(req: Request, res: Response) {
  const parsed = createSchema.safeParse(req.body);
  if (!parsed.success) throw HttpError.badRequest("Invalid system log entry", parsed.error.flatten());

  const entry = await recordSystemLog(parsed.data, req.user?.id);
  res.status(201).json(entry);
}

export async function getSystemLog(_req: Request, res: Response) {
  res.json(await listSystemLog());
}
