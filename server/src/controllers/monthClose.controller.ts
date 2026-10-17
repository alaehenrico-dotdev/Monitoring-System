import type { Request, Response } from "express";
import { z } from "zod";
import { HttpError } from "../utils/HttpError";
import { closeMonth, getMonthStatus, listMonthClosures, monthReadiness, parseYearMonth, unlockMonth } from "../services/monthClose.service";

const unlockSchema = z.object({ reason: z.string().trim().min(5, "Give a reason (at least 5 characters)").max(500) });

export async function getMonths(_req: Request, res: Response) {
  res.json(await listMonthClosures());
}

/// Open to every role: an encoder needs to know a month is closed before typing.
export async function getMonth(req: Request, res: Response) {
  res.json(await getMonthStatus(parseYearMonth(req.params.yearMonth)));
}

export async function getReadiness(req: Request, res: Response) {
  res.json(await monthReadiness(parseYearMonth(req.params.yearMonth)));
}

export async function postCloseMonth(req: Request, res: Response) {
  res.json(await closeMonth(parseYearMonth(req.params.yearMonth), req.user?.id));
}

export async function postUnlockMonth(req: Request, res: Response) {
  const parsed = unlockSchema.safeParse(req.body);
  if (!parsed.success) throw HttpError.badRequest(parsed.error.issues[0]?.message ?? "Invalid request", parsed.error.flatten());
  res.json(await unlockMonth(parseYearMonth(req.params.yearMonth), parsed.data.reason, req.user?.id));
}
