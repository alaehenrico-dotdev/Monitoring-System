import type { Request, Response } from "express";
import { z } from "zod";
import { parseDateOnly } from "../utils/date";
import { parseShift } from "../utils/shift";
import { HttpError } from "../utils/HttpError";
import { closeDay, closeReadiness, getClosureStatus, listClosures, unlockDay } from "../services/dayLock.service";

const unlockSchema = z.object({ reason: z.string().trim().min(5, "Give a reason (at least 5 characters)").max(500) });

export async function getClosures(req: Request, res: Response) {
  const from = req.query.from ? parseDateOnly(req.query.from) : undefined;
  const to = req.query.to ? parseDateOnly(req.query.to) : undefined;
  res.json(await listClosures({ from, to, closedOnly: req.query.closedOnly === "true" }));
}

/// Open to every role: encoders need to know a sheet is locked before they type.
export async function getStatus(req: Request, res: Response) {
  res.json(await getClosureStatus(parseDateOnly(req.query.date), parseShift(req.query.shift)));
}

export async function getReadiness(req: Request, res: Response) {
  res.json(await closeReadiness(parseDateOnly(req.query.date), parseShift(req.query.shift)));
}

export async function postClose(req: Request, res: Response) {
  const entryDate = parseDateOnly(req.body?.date);
  const shift = parseShift(req.body?.shift);
  res.json(await closeDay(entryDate, shift, req.user?.id));
}

export async function postUnlock(req: Request, res: Response) {
  const parsed = unlockSchema.safeParse(req.body);
  if (!parsed.success) throw HttpError.badRequest(parsed.error.issues[0]?.message ?? "Invalid request", parsed.error.flatten());
  res.json(await unlockDay(parseDateOnly(req.body?.date), parseShift(req.body?.shift), parsed.data.reason, req.user?.id));
}
