import { Shift, StockLocation } from "@prisma/client";
import { prisma, type Db } from "../lib/prisma";
import { HttpError } from "../utils/HttpError";
import { toDateOnlyString } from "../utils/date";
import { broadcastRealtimeEvent } from "../lib/realtime";
import { logSystemEvent } from "./changeLog.service";
import { findUnfinishedEarlierPeriod, isSideLocked, type EntryLocation } from "./dayLock.service";
import { getEntryRules } from "./appSettings.service";

/**
 * An encoder's way to ask for a finished page to be unlocked. Finishing a page
 * freezes it, and only an admin can unlock it; this gives the encoder a
 * recorded ask with a reason instead of having to find an admin out of band.
 * It changes nothing by itself: the request waits in the Admin Queue and is
 * resolved when the page is unlocked (unlockDay resolves it in its own
 * transaction), or when it no longer applies.
 *
 * A page is "locked" for an encoder in three ways, and a request makes sense for
 * each: it was finished, it is waiting on an earlier day that is not finished
 * yet (days are finished in order), or it is a day that was entered by shift and
 * shifts are now switched off, which shows it combined and read-only.
 */

export const MAX_REASON_LENGTH = 500;

export async function findPendingUnlockRequest(location: EntryLocation, entryDate: Date, shift: Shift, db: Db = prisma) {
  return db.unlockRequest.findFirst({
    where: { location: location as StockLocation, entryDate, shift, status: "PENDING" },
    orderBy: { id: "asc" },
    select: { id: true, reason: true, requestedAt: true },
  });
}

/// Whether the page is, right now, closed to entry: finished, held up by an
/// earlier unfinished day (while that rule is on), or a day entered by shift
/// while shifts are off (the whole-day view of it is read-only).
export async function isLockedForEntry(location: EntryLocation, entryDate: Date, shift: Shift): Promise<boolean> {
  const closure = await prisma.dayClosure.findUnique({
    where: { entryDate_shift: { entryDate, shift } },
    select: { onlineLocked: true, offlineLocked: true },
  });
  if (isSideLocked(closure, location)) return true;
  if ((await findUnfinishedEarlierPeriod(entryDate, prisma, location, "entry")) !== null) return true;
  if (shift === "NIGHT" && !(await getEntryRules()).useShifts) {
    const [online, offline] = await Promise.all([
      prisma.dailyOnlineStock.findFirst({ where: { entryDate, shift: "MORNING" }, select: { id: true } }),
      prisma.dailyOfflineStock.findFirst({ where: { entryDate, shift: "MORNING" }, select: { id: true } }),
    ]);
    return online !== null || offline !== null;
  }
  return false;
}

export async function resolveUnlockRequest(id: number, db: Db = prisma) {
  await db.unlockRequest.updateMany({ where: { id, status: "PENDING" }, data: { status: "RESOLVED", resolvedAt: new Date() } });
}

/// The request still waiting for this page. One whose page has since opened up
/// (an admin finished the earlier days, or switched the rule off) is closed here.
export async function currentUnlockRequest(location: EntryLocation, entryDate: Date, shift: Shift) {
  const pending = await findPendingUnlockRequest(location, entryDate, shift);
  if (!pending) return null;
  if (await isLockedForEntry(location, entryDate, shift)) return pending;
  await resolveUnlockRequest(pending.id);
  return null;
}

export async function requestUnlock(
  input: { location: EntryLocation; entryDate: Date; shift: Shift; reason: string },
  userId?: number,
) {
  const { location, entryDate, shift } = input;
  const reason = input.reason.trim();
  if (reason.length < 5) throw HttpError.badRequest("Give a reason (at least 5 characters)");
  if (reason.length > MAX_REASON_LENGTH) throw HttpError.badRequest(`The reason is at most ${MAX_REASON_LENGTH} characters`);

  if (!(await isLockedForEntry(location, entryDate, shift))) {
    throw HttpError.conflict("That page is open for entry (it is not finished, no earlier day is holding it, and it was not entered by shift), so there is nothing to unlock.");
  }

  // One open request per page: asking again shows the one already waiting.
  const existing = await findPendingUnlockRequest(location, entryDate, shift);
  if (existing) return { ...existing, alreadyRequested: true };

  const created = await prisma.unlockRequest.create({
    data: { location: location as StockLocation, entryDate, shift, reason, requestedById: userId ?? null },
    select: { id: true, reason: true, requestedAt: true },
  });
  await logSystemEvent("unlock_request", { location, date: toDateOnlyString(entryDate), shift, reason }, userId ?? null);
  broadcastRealtimeEvent();
  return { ...created, alreadyRequested: false };
}

/// Pending requests whose page has since opened up are closed, so the Admin
/// Queue lists only asks that still need an answer.
export async function sweepStaleUnlockRequests(): Promise<void> {
  const pending = await prisma.unlockRequest.findMany({
    where: { status: "PENDING" },
    take: 100,
    select: { id: true, location: true, entryDate: true, shift: true },
  });
  for (const r of pending) {
    if (r.location === "TOTAL") continue;
    if (!(await isLockedForEntry(r.location, r.entryDate, r.shift))) await resolveUnlockRequest(r.id);
  }
}

export function listPendingUnlockRequests(take = 20, db: Db = prisma) {
  return db.unlockRequest.findMany({
    where: { status: "PENDING" },
    orderBy: { id: "asc" },
    take,
    select: { id: true, location: true, entryDate: true, shift: true, reason: true, requestedAt: true },
  });
}

export function countPendingUnlockRequests(db: Db = prisma) {
  return db.unlockRequest.count({ where: { status: "PENDING" } });
}
