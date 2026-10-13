import { AsyncLocalStorage } from "node:async_hooks";
import { Shift } from "@prisma/client";
import { prisma, type Db } from "../lib/prisma";
import { HttpError } from "../utils/HttpError";
import { toDateOnlyString } from "../utils/date";
import { recordChange } from "./changeLog.service";
import { broadcastRealtimeEvent } from "../lib/realtime";

export const DAY_CLOSURES_TABLE = "day_closures";

const SHIFT_LABELS: Record<Shift, string> = { MORNING: "Morning", NIGHT: "Night" };

/// Set only while an approved correction is being applied: that is the
/// explicit, recorded adjustment path, and the one write allowed into a closed
/// period. Carried by AsyncLocalStorage so the save services need no extra
/// parameter threaded through every call.
const adjustment = new AsyncLocalStorage<true>();

export function runAsAdjustment<T>(fn: () => Promise<T>): Promise<T> {
  return adjustment.run(true, fn);
}

/// Refuses a write into a closed day. The message names the way out so an
/// encoder who hits it knows what to ask for.
export async function assertPeriodOpen(entryDate: Date, shift: Shift, db: Db = prisma): Promise<void> {
  if (adjustment.getStore()) return;
  const row = await db.dayClosure.findUnique({ where: { entryDate_shift: { entryDate, shift } } });
  if (row?.isClosed) {
    throw HttpError.conflict(
      `${toDateOnlyString(entryDate)} (${SHIFT_LABELS[shift]} shift) is closed. Ask an admin to unlock it, or request a correction instead.`,
    );
  }
}

export function listClosures(filters: { from?: Date; to?: Date; closedOnly?: boolean }) {
  return prisma.dayClosure.findMany({
    where: {
      entryDate: { gte: filters.from, lte: filters.to },
      ...(filters.closedOnly ? { isClosed: true } : {}),
    },
    include: {
      closedBy: { select: { id: true, name: true } },
      unlockedBy: { select: { id: true, name: true } },
    },
    orderBy: [{ entryDate: "desc" }, { shift: "asc" }],
    take: 500,
  });
}

export async function getClosureStatus(entryDate: Date, shift: Shift) {
  const row = await prisma.dayClosure.findUnique({ where: { entryDate_shift: { entryDate, shift } } });
  return { entryDate: toDateOnlyString(entryDate), shift, isClosed: row?.isClosed ?? false, closure: row };
}

/// What has to be true before a day may be closed: every count for it
/// published (it is "counted"), and a Daily Report generated (and exported -
/// history is only written after a successful export) for that date.
export async function closeReadiness(entryDate: Date, shift: Shift) {
  const counts = await prisma.manualCount.findMany({
    where: { entryDate, shift },
    select: { publishedAt: true },
  });
  const dateStr = toDateOnlyString(entryDate);
  const report = await prisma.reportHistoryEntry.findFirst({
    where: { type: "Daily Report", scope: { contains: dateStr } },
    select: { id: true },
  });
  const unpublished = counts.filter((c) => !c.publishedAt).length;
  const problems: string[] = [];
  if (counts.length === 0) problems.push("No manual count has been saved for this day and shift.");
  if (unpublished > 0) problems.push(`${unpublished} count(s) are still unpublished.`);
  if (!report) problems.push("No Daily Report has been exported for this date.");
  return { ready: problems.length === 0, problems };
}

export async function closeDay(entryDate: Date, shift: Shift, userId?: number) {
  const readiness = await closeReadiness(entryDate, shift);
  if (!readiness.ready) {
    throw HttpError.badRequest(`This day can't be closed yet: ${readiness.problems.join(" ")}`, readiness);
  }
  const result = await prisma.$transaction(async (tx) => {
    const existing = await tx.dayClosure.findUnique({ where: { entryDate_shift: { entryDate, shift } } });
    if (existing?.isClosed) return existing;
    const data = { isClosed: true, closedAt: new Date(), closedById: userId ?? null, unlockedAt: null, unlockedById: null, unlockReason: null };
    const saved = existing
      ? await tx.dayClosure.update({ where: { id: existing.id }, data })
      : await tx.dayClosure.create({ data: { entryDate, shift, ...data } });
    await recordChange(
      { tableName: DAY_CLOSURES_TABLE, recordId: saved.id, action: existing ? "UPDATE" : "CREATE", changedById: userId, oldValue: existing ?? undefined, newValue: saved },
      tx,
    );
    return saved;
  });
  broadcastRealtimeEvent();
  return result;
}

export async function unlockDay(entryDate: Date, shift: Shift, reason: string, userId?: number) {
  const result = await prisma.$transaction(async (tx) => {
    const existing = await tx.dayClosure.findUnique({ where: { entryDate_shift: { entryDate, shift } } });
    if (!existing?.isClosed) throw HttpError.conflict("That day is not closed.");
    const saved = await tx.dayClosure.update({
      where: { id: existing.id },
      data: { isClosed: false, unlockedAt: new Date(), unlockedById: userId ?? null, unlockReason: reason },
    });
    await recordChange(
      { tableName: DAY_CLOSURES_TABLE, recordId: saved.id, action: "UPDATE", changedById: userId, oldValue: existing, newValue: { ...saved, reason } },
      tx,
    );
    return saved;
  });
  broadcastRealtimeEvent();
  return result;
}
