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
///
/// `scope` is what is being written: "entry" (the Online/Offline grids, and
/// anything that rewrites them) is refused by every closure; "count" (Manual
/// Counts) is let through a closure that was only an encoder's "Finish day"
/// (`entriesOnly`), so the audit can still happen after the entries are done.
export async function assertPeriodOpen(
  entryDate: Date,
  shift: Shift,
  db: Db = prisma,
  scope: "entry" | "count" = "entry",
): Promise<void> {
  if (adjustment.getStore()) return;
  const row = await db.dayClosure.findUnique({ where: { entryDate_shift: { entryDate, shift } } });
  if (row?.isClosed && !(scope === "count" && row.entriesOnly)) {
    throw HttpError.conflict(
      `${toDateOnlyString(entryDate)} (${SHIFT_LABELS[shift]} shift) is closed. Ask an admin to unlock it, or request a correction instead.`,
    );
  }
}

/// A date + shift that has saved entries but has not been finished.
export interface UnfinishedPeriod {
  entryDate: string;
  shift: Shift;
}

/**
 * The earliest day BEFORE `entryDate` that has saved Online/Offline entries and
 * is not finished - the day that has to be finished first, because days are
 * finished in order. Null when there is none.
 *
 * Day-level, not shift-level: Morning and Night of the same date are not
 * ordered against each other. Only days from the first one ever finished
 * onwards count: everything entered before Finish day existed was never
 * finished, and must not suddenly block all new entries. Skipped inside an
 * approved correction (runAsAdjustment), like the closed-day lock.
 */
export async function findUnfinishedEarlierPeriod(entryDate: Date, db: Db = prisma): Promise<UnfinishedPeriod | null> {
  if (adjustment.getStore()) return null;
  const first = await db.dayClosure.findFirst({ orderBy: { entryDate: "asc" }, select: { entryDate: true } });
  if (!first || first.entryDate >= entryDate) return null;

  const range = { gte: first.entryDate, lt: entryDate };
  const [online, offline, closures] = await Promise.all([
    db.dailyOnlineStock.groupBy({ by: ["entryDate", "shift"], where: { entryDate: range } }),
    db.dailyOfflineStock.groupBy({ by: ["entryDate", "shift"], where: { entryDate: range } }),
    db.dayClosure.findMany({ where: { entryDate: range, isClosed: true }, select: { entryDate: true, shift: true } }),
  ]);
  const id = (p: { entryDate: Date; shift: Shift }) => `${toDateOnlyString(p.entryDate)}:${p.shift}`;
  const closed = new Set(closures.map(id));
  const order = (p: { entryDate: Date; shift: Shift }) => `${toDateOnlyString(p.entryDate)}:${p.shift === "MORNING" ? 0 : 1}`;
  const open = [...online, ...offline].filter((p) => !closed.has(id(p))).sort((a, b) => order(a).localeCompare(order(b)));
  return open.length ? { entryDate: toDateOnlyString(open[0].entryDate), shift: open[0].shift } : null;
}

/// Refuses an entry write (or a Finish day) while an earlier day is unfinished.
export async function assertEarlierDaysFinished(entryDate: Date, db: Db = prisma): Promise<void> {
  const blocker = await findUnfinishedEarlierPeriod(entryDate, db);
  if (blocker) {
    throw HttpError.conflict(
      `Finish ${blocker.entryDate} (${SHIFT_LABELS[blocker.shift]} shift) before entering ${toDateOnlyString(entryDate)}: days are finished in order.`,
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
  return {
    entryDate: toDateOnlyString(entryDate),
    shift,
    isClosed: row?.isClosed ?? false,
    closure: row,
    /// The earlier day that must be finished before this one can be entered.
    blockedBy: await findUnfinishedEarlierPeriod(entryDate),
  };
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

/// Writes the closure row (and its change-log entry) inside the caller's
/// transaction. `entriesOnly` is the encoder's "Finish day" lock; a full close
/// (admin) both locks everything and upgrades an existing entries-only lock.
/// Returns the existing row untouched when the period is already locked at
/// least as hard as asked.
export async function closePeriod(
  entryDate: Date,
  shift: Shift,
  opts: { entriesOnly: boolean; userId?: number },
  tx: Db,
) {
  const existing = await tx.dayClosure.findUnique({ where: { entryDate_shift: { entryDate, shift } } });
  if (existing?.isClosed && (opts.entriesOnly || !existing.entriesOnly)) return existing;
  const data = {
    isClosed: true,
    entriesOnly: opts.entriesOnly,
    closedAt: new Date(),
    closedById: opts.userId ?? null,
    unlockedAt: null,
    unlockedById: null,
    unlockReason: null,
  };
  const saved = existing
    ? await tx.dayClosure.update({ where: { id: existing.id }, data })
    : await tx.dayClosure.create({ data: { entryDate, shift, ...data } });
  await recordChange(
    { tableName: DAY_CLOSURES_TABLE, recordId: saved.id, action: existing ? "UPDATE" : "CREATE", changedById: opts.userId, oldValue: existing ?? undefined, newValue: saved },
    tx,
  );
  return saved;
}

export async function closeDay(entryDate: Date, shift: Shift, userId?: number) {
  const readiness = await closeReadiness(entryDate, shift);
  if (!readiness.ready) {
    throw HttpError.badRequest(`This day can't be closed yet: ${readiness.problems.join(" ")}`, readiness);
  }
  const result = await prisma.$transaction((tx) => closePeriod(entryDate, shift, { entriesOnly: false, userId }, tx));
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
