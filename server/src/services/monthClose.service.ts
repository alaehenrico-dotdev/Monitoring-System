import { CorrectionStatus } from "@prisma/client";
import { prisma, serializableTransaction, type Db } from "../lib/prisma";
import { HttpError } from "../utils/HttpError";
import { toDateOnlyString } from "../utils/date";
import { broadcastRealtimeEvent } from "../lib/realtime";
import { recordChange } from "./changeLog.service";

export const MONTH_CLOSURES_TABLE = "month_closures";

const SHIFT_LABELS = { MORNING: "Morning", NIGHT: "Night" } as const;

export function parseYearMonth(value: unknown): string {
  if (typeof value !== "string" || !/^\d{4}-(0[1-9]|1[0-2])$/.test(value)) {
    throw HttpError.badRequest('Expected a month in "YYYY-MM" format');
  }
  return value;
}

/// First and last calendar day of a "YYYY-MM", as UTC-midnight dates.
export function monthBounds(yearMonth: string): { from: Date; to: Date } {
  const [y, m] = yearMonth.split("-").map(Number);
  return { from: new Date(Date.UTC(y, m - 1, 1)), to: new Date(Date.UTC(y, m, 0)) };
}

export interface MonthReadiness {
  yearMonth: string;
  ready: boolean;
  /// Reasons the month cannot be closed yet.
  problems: string[];
  /// Things worth a look that do not stop the close.
  warnings: string[];
  /// What closing would lock.
  periodsWithEntries: number;
}

/**
 * What has to be true before a month is closed: it has ended, it has entries,
 * every period with entries is finished on both pages, every count in it is
 * published, and no correction (or held opening) against it is still pending -
 * closing must never freeze a figure someone is still waiting on.
 *
 * `db` is the client to read through: closeMonth passes its transaction, so the
 * check and the lock are one atomic step (see there).
 *
 * Days with no entries and awaiting-release items made in the month are only
 * warnings: a day nobody worked is legitimate, and an awaiting item is released
 * into a later month's stock by design.
 */
export async function monthReadiness(yearMonth: string, now: Date = new Date(), db: Db = prisma): Promise<MonthReadiness> {
  const { from, to } = monthBounds(yearMonth);
  const range = { gte: from, lte: to };
  const problems: string[] = [];
  const warnings: string[] = [];

  // Conservative on purpose: the server's UTC date trails a UTC+8 shop floor, so
  // the month only becomes closable after its last Night shift has really ended.
  if (toDateOnlyString(now) <= toDateOnlyString(to)) problems.push(`${yearMonth} has not ended yet.`);

  const [online, offline, closures, unpublished, pending, awaiting] = await Promise.all([
    db.dailyOnlineStock.groupBy({ by: ["entryDate", "shift"], where: { entryDate: range } }),
    db.dailyOfflineStock.groupBy({ by: ["entryDate", "shift"], where: { entryDate: range } }),
    db.dayClosure.findMany({ where: { entryDate: range }, select: { entryDate: true, shift: true, onlineLocked: true, offlineLocked: true } }),
    db.manualCount.count({ where: { entryDate: range, publishedAt: null } }),
    db.correctionRequest.findMany({ where: { status: CorrectionStatus.PENDING }, select: { tableName: true, recordId: true } }),
    db.pendingRelease.count({ where: { status: "AWAITING", madeDate: range } }),
  ]);

  const id = (p: { entryDate: Date; shift: keyof typeof SHIFT_LABELS }) => `${toDateOnlyString(p.entryDate)}:${p.shift}`;
  const order = (p: { entryDate: Date; shift: keyof typeof SHIFT_LABELS }) => `${toDateOnlyString(p.entryDate)}:${p.shift === "MORNING" ? 0 : 1}`;
  const onlineLocked = new Set(closures.filter((c) => c.onlineLocked).map(id));
  const offlineLocked = new Set(closures.filter((c) => c.offlineLocked).map(id));

  const unfinished = [
    ...online.filter((p) => !onlineLocked.has(id(p))).map((p) => ({ ...p, page: "Online" })),
    ...offline.filter((p) => !offlineLocked.has(id(p))).map((p) => ({ ...p, page: "Offline" })),
  ].sort((a, b) => order(a).localeCompare(order(b)));

  const periodsWithEntries = new Set([...online, ...offline].map(id)).size;
  if (periodsWithEntries === 0) problems.push(`There are no entries in ${yearMonth}, so there is nothing to close.`);
  if (unfinished.length > 0) {
    const first = unfinished[0];
    problems.push(
      `${unfinished.length} page(s) are not finished - first: ${toDateOnlyString(first.entryDate)} (${SHIFT_LABELS[first.shift]}, ${first.page}).`,
    );
  }
  if (unpublished > 0) problems.push(`${unpublished} count(s) in ${yearMonth} are still unpublished.`);

  // A pending request is "in this month" when the row it points at is.
  const idsFor = (table: string) => pending.filter((p) => p.tableName === table).map((p) => p.recordId);
  const [pOnline, pOffline, pCounts] = await Promise.all([
    idsFor("daily_online_stock").length
      ? db.dailyOnlineStock.count({ where: { id: { in: idsFor("daily_online_stock") }, entryDate: range } })
      : 0,
    idsFor("daily_offline_stock").length
      ? db.dailyOfflineStock.count({ where: { id: { in: idsFor("daily_offline_stock") }, entryDate: range } })
      : 0,
    idsFor("manual_counts").length ? db.manualCount.count({ where: { id: { in: idsFor("manual_counts") }, entryDate: range } }) : 0,
  ]);
  const pendingInMonth = pOnline + pOffline + pCounts;
  if (pendingInMonth > 0) problems.push(`${pendingInMonth} correction request(s) against ${yearMonth} are still pending.`);

  // Gaps: a day before the month's last worked day with nothing saved at all.
  const worked = new Set([...online, ...offline].map((p) => toDateOnlyString(p.entryDate)));
  if (worked.size > 0) {
    const lastWorked = [...worked].sort().at(-1)!;
    const gaps: string[] = [];
    for (let d = new Date(from); toDateOnlyString(d) < lastWorked; d.setUTCDate(d.getUTCDate() + 1)) {
      if (!worked.has(toDateOnlyString(d))) gaps.push(toDateOnlyString(d));
    }
    if (gaps.length > 0) {
      warnings.push(`No entries at all on ${gaps.length} day(s): ${gaps.slice(0, 8).join(", ")}${gaps.length > 8 ? ", ..." : ""}.`);
    }
  }
  if (awaiting > 0) warnings.push(`${awaiting} awaiting-release item(s) made in ${yearMonth} are not released yet; they will enter stock when released.`);

  return { yearMonth, ready: problems.length === 0, problems, warnings, periodsWithEntries };
}

export function listMonthClosures() {
  return prisma.monthClosure.findMany({
    include: { closedBy: { select: { id: true, name: true } }, unlockedBy: { select: { id: true, name: true } } },
    orderBy: { yearMonth: "desc" },
    take: 120,
  });
}

/// The readiness check and the lock happen in ONE serializable transaction (the
/// same pattern the entry saves use): a period un-finished, or an entry saved,
/// between "it was ready" and "it is closed" would otherwise slip into a month
/// that then reports as closed. Under SERIALIZABLE the reads below lock what they
/// scanned, so a concurrent write to those dates waits for the close - or one of
/// the two is aborted with a retryable conflict (the API answers 503) instead of
/// both succeeding.
export async function closeMonth(yearMonth: string, userId?: number) {
  const result = await serializableTransaction(async (tx) => {
    const readiness = await monthReadiness(yearMonth, new Date(), tx);
    if (!readiness.ready) {
      throw HttpError.badRequest(`${yearMonth} can't be closed yet: ${readiness.problems.join(" ")}`, readiness);
    }
    const existing = await tx.monthClosure.findUnique({ where: { yearMonth } });
    if (existing?.isClosed) throw HttpError.conflict(`${yearMonth} is already closed.`);
    const data = { isClosed: true, closedAt: new Date(), closedById: userId ?? null, unlockedAt: null, unlockedById: null, unlockReason: null };
    const saved = existing
      ? await tx.monthClosure.update({ where: { id: existing.id }, data })
      : await tx.monthClosure.create({ data: { yearMonth, ...data } });
    await recordChange(
      { tableName: MONTH_CLOSURES_TABLE, recordId: saved.id, action: existing ? "UPDATE" : "CREATE", changedById: userId, oldValue: existing ?? undefined, newValue: saved },
      tx,
    );
    return { ...saved, warnings: readiness.warnings };
  });
  broadcastRealtimeEvent();
  return result;
}

export async function unlockMonth(yearMonth: string, reason: string, userId?: number) {
  const result = await prisma.$transaction(async (tx) => {
    const existing = await tx.monthClosure.findUnique({ where: { yearMonth } });
    if (!existing?.isClosed) throw HttpError.conflict(`${yearMonth} is not closed.`);
    const saved = await tx.monthClosure.update({
      where: { id: existing.id },
      data: { isClosed: false, unlockedAt: new Date(), unlockedById: userId ?? null, unlockReason: reason },
    });
    await recordChange(
      { tableName: MONTH_CLOSURES_TABLE, recordId: saved.id, action: "UPDATE", changedById: userId, oldValue: existing, newValue: { ...saved, reason } },
      tx,
    );
    return saved;
  });
  broadcastRealtimeEvent();
  return result;
}

export async function getMonthStatus(yearMonth: string) {
  const row = await prisma.monthClosure.findUnique({ where: { yearMonth } });
  return { yearMonth, isClosed: !!row?.isClosed, closure: row };
}
