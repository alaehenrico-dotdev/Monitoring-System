import { AsyncLocalStorage } from "node:async_hooks";
import { Shift } from "@prisma/client";
import { prisma, type Db } from "../lib/prisma";
import { HttpError } from "../utils/HttpError";
import { toDateOnlyString } from "../utils/date";
import { recordChange } from "./changeLog.service";
import { broadcastRealtimeEvent } from "../lib/realtime";
import { getEntryRules } from "./appSettings.service";

export const DAY_CLOSURES_TABLE = "day_closures";

const SHIFT_LABELS: Record<Shift, string> = { MORNING: "Morning", NIGHT: "Night" };

/// Set only while an approved correction is being applied: that is the
/// explicit, recorded adjustment path, and the one write allowed into a closed
/// period. Carried by AsyncLocalStorage so the save services need no extra
/// parameter threaded through every call.
///
/// `cascade` is whether the approver also accepted the consequences for the
/// LATER locked days: a corrected figure changes every opening stock after it.
/// Without it only the corrected row is written, and each later locked day
/// that would move is held for its own approval instead (staleOpening.service.ts).
const adjustment = new AsyncLocalStorage<{ cascade: boolean }>();

export function runAsAdjustment<T>(fn: () => Promise<T>, opts: { cascade?: boolean } = {}): Promise<T> {
  return adjustment.run({ cascade: opts.cascade ?? false }, fn);
}

/// The two entry pages, which are finished (locked) independently of each other.
export type EntryLocation = "ONLINE" | "OFFLINE";

/// Whether one entry page of a period is locked.
export function isSideLocked(
  row: { onlineLocked: boolean; offlineLocked: boolean } | null | undefined,
  location: EntryLocation,
): boolean {
  if (!row) return false;
  return location === "ONLINE" ? row.onlineLocked : row.offlineLocked;
}

/// The other entry page - the one a transfer entered on `location` also changes.
export const otherLocation = (location: EntryLocation): EntryLocation => (location === "ONLINE" ? "OFFLINE" : "ONLINE");

/// "YYYY-MM" of a business date.
export const yearMonthOf = (entryDate: Date): string => toDateOnlyString(entryDate).slice(0, 7);

/// Whether the calendar month holding `entryDate` has been closed by an admin
/// (monthClose.service.ts) - the lock layer above a day's own.
export async function isMonthClosed(entryDate: Date, db: Db = prisma): Promise<boolean> {
  const row = await db.monthClosure.findUnique({ where: { yearMonth: yearMonthOf(entryDate) } });
  return !!row?.isClosed;
}

/// Refuses a write into a closed month. Lifted only by an approved correction,
/// the one recorded way into a closed period.
export async function assertMonthOpen(entryDate: Date, db: Db = prisma): Promise<void> {
  if (adjustment.getStore()) return;
  if (await isMonthClosed(entryDate, db)) {
    throw HttpError.conflict(`${yearMonthOf(entryDate)} is a closed month. Ask an admin to reopen it, or request a correction instead.`);
  }
}

/// Whole-day mode (Settings > Entry Rules > shifts off): a day is one sheet,
/// saved as the Night sheet of the calendar date. So nothing may be written to a
/// Morning sheet, and a day that was already entered by shift stays as it was -
/// it shows combined and read-only rather than being half rewritten. Counts
/// (the audit) are let onto such a day, since they only compare against it.
async function assertShiftModeAllows(entryDate: Date, shift: Shift, scope: "entry" | "count", db: Db): Promise<void> {
  if ((await getEntryRules()).useShifts) return;
  if (shift === "MORNING") {
    throw HttpError.badRequest("Shifts are switched off: the whole day is saved as one sheet. Use the whole-day sheet instead of Morning.");
  }
  if (scope !== "entry") return;
  const [online, offline] = await Promise.all([
    db.dailyOnlineStock.findFirst({ where: { entryDate, shift: "MORNING" }, select: { id: true } }),
    db.dailyOfflineStock.findFirst({ where: { entryDate, shift: "MORNING" }, select: { id: true } }),
  ]);
  if (online || offline) {
    throw HttpError.conflict(
      `${toDateOnlyString(entryDate)} was entered by shift (Morning and Night), so it is read-only while shifts are switched off. Switch shifts back on to edit it, or request a correction.`,
    );
  }
}

/// Refuses a write into a closed day. The message names the way out so an
/// encoder who hits it knows what to ask for.
///
/// `scope` is what is being written: "entry" (the Online/Offline grids, and
/// anything that rewrites them) is refused while the page being written is
/// locked - pass its `location`; without one, either page being locked refuses
/// it. "count" (Manual Counts) is let through anything short of an admin's full
/// close (`entriesOnly`), so the audit can still happen after the entries are
/// done.
export async function assertPeriodOpen(
  entryDate: Date,
  shift: Shift,
  db: Db = prisma,
  scope: "entry" | "count" = "entry",
  location?: EntryLocation,
): Promise<void> {
  if (adjustment.getStore()) return;
  await assertShiftModeAllows(entryDate, shift, scope, db);
  await assertMonthOpen(entryDate, db);
  const row = await db.dayClosure.findUnique({ where: { entryDate_shift: { entryDate, shift } } });
  if (!row) return;
  const locked =
    scope === "count"
      ? row.isClosed && !row.entriesOnly
      : location
        ? isSideLocked(row, location)
        : row.onlineLocked || row.offlineLocked;
  if (locked) {
    const page = scope === "entry" && location ? `${location === "ONLINE" ? "Online" : "Offline"} entries for ` : "";
    throw HttpError.conflict(
      `${page}${toDateOnlyString(entryDate)} (${SHIFT_LABELS[shift]} shift) ${page ? "are" : "is"} finished and locked. Ask an admin to unlock it, or request a correction instead.`,
    );
  }
}

/// Whether a LATER period is locked against having its opening stock re-derived
/// by a carry-forward from an earlier change. Unlike assertPeriodOpen it does
/// not throw (the caller holds the change for approval instead) and it is not
/// lifted by an ordinary approved correction: that approval covered one figure,
/// not every day after it. Only an approval that chose to cascade lifts it.
export async function isLockedForCarry(entryDate: Date, shift: Shift, location: EntryLocation, db: Db = prisma): Promise<boolean> {
  // A closed month is the stronger lock: even a cascading approval does not
  // rewrite it in bulk - each such day is held for its own approval.
  if (await isMonthClosed(entryDate, db)) return true;
  if (adjustment.getStore()?.cascade) return false;
  const row = await db.dayClosure.findUnique({ where: { entryDate_shift: { entryDate, shift } } });
  return isSideLocked(row, location);
}

/// Whether the OTHER entry page of this period is locked - the situation in
/// which a transfer entered on `location` cannot simply be mirrored over, and
/// has to go to an admin for approval. False inside an approved correction.
export async function isCounterpartLocked(entryDate: Date, shift: Shift, location: EntryLocation, db: Db = prisma): Promise<boolean> {
  if (adjustment.getStore()) return false;
  const row = await db.dayClosure.findUnique({ where: { entryDate_shift: { entryDate, shift } } });
  return isSideLocked(row, otherLocation(location));
}

/// A date + shift that has saved entries but has not been finished.
export interface UnfinishedPeriod {
  entryDate: string;
  shift: Shift;
}

/**
 * The earliest day BEFORE `entryDate` that has saved entries and is not
 * finished - the day that has to be finished first, because days are finished
 * in order. Null when there is none.
 *
 * With a `location`, only that page counts: Online is blocked by an earlier day
 * Online has not finished, whatever Offline has done, and vice versa. Without
 * one, either page being unfinished counts.
 *
 * Day-level, not shift-level: Morning and Night of the same date are not
 * ordered against each other. Only days from the first one ever finished
 * onwards count: everything entered before Finish day existed was never
 * finished, and must not suddenly block all new entries. Skipped inside an
 * approved correction (runAsAdjustment), like the closed-day lock.
 *
 * `purpose` is what the answer is used for. "entry" (saving figures) is waived
 * when an admin has turned off Settings > Entry Rules > "Finish days in order",
 * so the present day can be filled in while earlier days are still open.
 * "finish" (locking a day) is never waived: the locks stay in sequence, so a day
 * is never locked while an earlier one can still change under it.
 */
export async function findUnfinishedEarlierPeriod(
  entryDate: Date,
  db: Db = prisma,
  location?: EntryLocation,
  purpose: "entry" | "finish" = "entry",
): Promise<UnfinishedPeriod | null> {
  if (adjustment.getStore()) return null;
  if (purpose === "entry" && !(await getEntryRules()).requireEarlierDaysFinished) return null;
  const first = await db.dayClosure.findFirst({ orderBy: { entryDate: "asc" }, select: { entryDate: true } });
  if (!first || first.entryDate >= entryDate) return null;

  const range = { gte: first.entryDate, lt: entryDate };
  const [online, offline, closures] = await Promise.all([
    location === "OFFLINE" ? [] : db.dailyOnlineStock.groupBy({ by: ["entryDate", "shift"], where: { entryDate: range } }),
    location === "ONLINE" ? [] : db.dailyOfflineStock.groupBy({ by: ["entryDate", "shift"], where: { entryDate: range } }),
    db.dayClosure.findMany({
      where: { entryDate: range },
      select: { entryDate: true, shift: true, onlineLocked: true, offlineLocked: true },
    }),
  ]);
  const id = (p: { entryDate: Date; shift: Shift }) => `${toDateOnlyString(p.entryDate)}:${p.shift}`;
  const onlineClosed = new Set(closures.filter((c) => c.onlineLocked).map(id));
  const offlineClosed = new Set(closures.filter((c) => c.offlineLocked).map(id));
  const order = (p: { entryDate: Date; shift: Shift }) => `${toDateOnlyString(p.entryDate)}:${p.shift === "MORNING" ? 0 : 1}`;
  const open = [...online.filter((p) => !onlineClosed.has(id(p))), ...offline.filter((p) => !offlineClosed.has(id(p)))].sort((a, b) =>
    order(a).localeCompare(order(b)),
  );
  return open.length ? { entryDate: toDateOnlyString(open[0].entryDate), shift: open[0].shift } : null;
}

/// Refuses an entry write (or a Finish day) while an earlier day is unfinished.
export async function assertEarlierDaysFinished(
  entryDate: Date,
  db: Db = prisma,
  location?: EntryLocation,
  purpose: "entry" | "finish" = "entry",
): Promise<void> {
  const blocker = await findUnfinishedEarlierPeriod(entryDate, db, location, purpose);
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
      ...(filters.closedOnly ? { OR: [{ onlineLocked: true }, { offlineLocked: true }] } : {}),
    },
    include: {
      closedBy: { select: { id: true, name: true } },
      unlockedBy: { select: { id: true, name: true } },
    },
    orderBy: [{ entryDate: "desc" }, { shift: "asc" }],
    take: 500,
  });
}

/// `location` narrows the answer to one entry page: `locked` is that page's
/// lock and `blockedBy` the earlier day that page still has to finish. Without
/// it, `locked` is true only when both pages are.
export async function getClosureStatus(entryDate: Date, shift: Shift, location?: EntryLocation) {
  const row = await prisma.dayClosure.findUnique({ where: { entryDate_shift: { entryDate, shift } } });
  // Asked for finishing, which is never waived; the entry answer is derived from
  // it so the two cannot disagree (and the day-by-day scan runs only once).
  const blockedBy = await findUnfinishedEarlierPeriod(entryDate, prisma, location, "finish");
  const rules = await getEntryRules();
  return {
    entryDate: toDateOnlyString(entryDate),
    shift,
    isClosed: row?.isClosed ?? false,
    onlineLocked: row?.onlineLocked ?? false,
    offlineLocked: row?.offlineLocked ?? false,
    locked: location ? isSideLocked(row, location) : (row?.isClosed ?? false),
    closure: row,
    /// The earlier day that must be finished before THIS day can be finished.
    blockedBy,
    /// The earlier day that must be finished before this one can be ENTERED:
    /// the same day, unless the entry rules let people enter ahead of it.
    entryBlockedBy: rules.requireEarlierDaysFinished ? blockedBy : null,
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
/// `location` is the one entry page an encoder finished; omitted, both pages are
/// locked. Returns the existing row untouched when what was asked for is
/// already locked at least that hard.
export async function closePeriod(
  entryDate: Date,
  shift: Shift,
  opts: { entriesOnly: boolean; userId?: number; location?: EntryLocation },
  tx: Db,
) {
  const existing = await tx.dayClosure.findUnique({ where: { entryDate_shift: { entryDate, shift } } });
  if (opts.location) {
    if (existing && isSideLocked(existing, opts.location)) return existing;
  } else if (existing?.isClosed && (opts.entriesOnly || !existing.entriesOnly)) {
    return existing;
  }
  const onlineLocked = !opts.location || opts.location === "ONLINE" ? true : (existing?.onlineLocked ?? false);
  const offlineLocked = !opts.location || opts.location === "OFFLINE" ? true : (existing?.offlineLocked ?? false);
  const data = {
    isClosed: onlineLocked && offlineLocked,
    onlineLocked,
    offlineLocked,
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

/// Unlocks one entry page, or (no `location`) the whole period.
export async function unlockDay(entryDate: Date, shift: Shift, reason: string, userId?: number, location?: EntryLocation) {
  const result = await prisma.$transaction(async (tx) => {
    const existing = await tx.dayClosure.findUnique({ where: { entryDate_shift: { entryDate, shift } } });
    const anyLocked = location ? isSideLocked(existing, location) : !!existing && (existing.onlineLocked || existing.offlineLocked);
    if (!existing || !anyLocked) throw HttpError.conflict("That day is not closed.");
    const saved = await tx.dayClosure.update({
      where: { id: existing.id },
      data: {
        isClosed: false,
        onlineLocked: !location || location === "ONLINE" ? false : existing.onlineLocked,
        offlineLocked: !location || location === "OFFLINE" ? false : existing.offlineLocked,
        unlockedAt: new Date(),
        unlockedById: userId ?? null,
        unlockReason: reason,
      },
    });
    await recordChange(
      {
        tableName: DAY_CLOSURES_TABLE,
        recordId: saved.id,
        action: "UPDATE",
        changedById: userId,
        oldValue: existing,
        newValue: { ...saved, reason, location: location ?? "ALL" },
      },
      tx,
    );
    // The encoder's ask (if any) for this page has been answered.
    await tx.unlockRequest.updateMany({
      where: { entryDate, shift, status: "PENDING", ...(location ? { location } : {}) },
      data: { status: "RESOLVED", resolvedAt: new Date() },
    });
    return saved;
  });
  broadcastRealtimeEvent();
  return result;
}
