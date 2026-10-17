import type { Request, Response } from "express";
import { z } from "zod";
import { parseDateOnly } from "../utils/date";
import { parseShift } from "../utils/shift";
import { HttpError } from "../utils/HttpError";
import { finishDay, getFinishSummary } from "../services/dayFinish.service";
import { finishThrough, previewFinishThrough } from "../services/finishThrough.service";
import { closeDay, closeReadiness, getClosureStatus, listClosures, unlockDay, type EntryLocation } from "../services/dayLock.service";

const unlockSchema = z.object({
  reason: z.string().trim().min(5, "Give a reason (at least 5 characters)").max(500),
  // Which entry page to unlock; leave out to unlock the whole period.
  location: z.enum(["ONLINE", "OFFLINE"]).optional(),
});

/// The entry page a request is about: optional where the answer can be about
/// the whole period, otherwise required.
function parseLocation(value: unknown): EntryLocation | undefined {
  if (value === undefined || value === "") return undefined;
  if (value === "ONLINE" || value === "OFFLINE") return value;
  throw HttpError.badRequest("location must be ONLINE or OFFLINE");
}

export async function getClosures(req: Request, res: Response) {
  const from = req.query.from ? parseDateOnly(req.query.from) : undefined;
  const to = req.query.to ? parseDateOnly(req.query.to) : undefined;
  res.json(await listClosures({ from, to, closedOnly: req.query.closedOnly === "true" }));
}

/// Open to every role: encoders need to know a sheet is locked before they type.
export async function getStatus(req: Request, res: Response) {
  res.json(await getClosureStatus(parseDateOnly(req.query.date), parseShift(req.query.shift), parseLocation(req.query.location)));
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
  res.json(await unlockDay(parseDateOnly(req.body?.date), parseShift(req.body?.shift), parsed.data.reason, req.user?.id, parsed.data.location));
}

/// What finishing this shift would lock - open to every role, like the status.
export async function getFinishInfo(req: Request, res: Response) {
  res.json(await getFinishSummary(parseDateOnly(req.query.date), parseShift(req.query.shift), parseLocation(req.query.location)));
}

/// The encoder's "Finish day": lock ONE entry page (and, once both pages are
/// finished, save the report snapshot). An encoder can only finish their own
/// page; an admin can finish either.
export async function postFinish(req: Request, res: Response) {
  const location = parseLocation(req.body?.location);
  if (!location) throw HttpError.badRequest("Say which page to finish (location: ONLINE or OFFLINE)");
  const role = req.user?.role;
  if ((role === "ONLINE_ENCODER" && location !== "ONLINE") || (role === "OFFLINE_ENCODER" && location !== "OFFLINE")) {
    throw HttpError.forbidden("You can only finish your own entry page.");
  }
  res.json(await finishDay(parseDateOnly(req.body?.date), parseShift(req.body?.shift), location, req.user?.id));
}

/// An encoder can only finish their own page; an admin can finish either.
function finishLocation(req: Request, value: unknown): EntryLocation {
  const location = parseLocation(value);
  if (!location) throw HttpError.badRequest("Say which page to finish (location: ONLINE or OFFLINE)");
  const role = req.user?.role;
  if ((role === "ONLINE_ENCODER" && location !== "ONLINE") || (role === "OFFLINE_ENCODER" && location !== "OFFLINE")) {
    throw HttpError.forbidden("You can only finish your own entry page.");
  }
  return location;
}

/// What "finish through this date" would lock, with blockers and warnings.
export async function getFinishThroughPreview(req: Request, res: Response) {
  res.json(await previewFinishThrough(parseDateOnly(req.query.through), finishLocation(req, req.query.location)));
}

/// Finishes every unfinished period of one page up to the date, oldest first, all
/// or nothing. Warnings must be acknowledged; blockers cannot be.
export async function postFinishThrough(req: Request, res: Response) {
  const location = finishLocation(req, req.body?.location);
  res.json(
    await finishThrough(parseDateOnly(req.body?.through), location, req.user?.id, { acknowledgeWarnings: req.body?.acknowledgeWarnings === true }),
  );
}
