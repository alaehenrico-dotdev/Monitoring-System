import { Shift } from "@prisma/client";
import { prisma } from "../lib/prisma";
import { HttpError } from "../utils/HttpError";
import { toDateOnlyString } from "../utils/date";
import { broadcastRealtimeEvent } from "../lib/realtime";
import { closePeriod, type EntryLocation } from "./dayLock.service";
import { buildDailyReport } from "./reports.service";
import { saveSnapshot } from "./dailyReportSnapshot.service";
import { notifyDailyReportSaved } from "../lib/reportSaved";
import { recordReportHistoryIn } from "./reportHistory.service";

/**
 * "Finish through date": the encoder's catch-up. Instead of finishing a backlog
 * of days one by one, they name the latest date they are sure of and every
 * unfinished period of their page up to it is finished together, oldest first,
 * in ONE transaction - so the stock chain is never finished out of order and a
 * failure part way locks nothing.
 *
 * It is a plan first, then an act. The plan lists exactly what would be locked
 * and is the thing the confirmation dialog shows. Hard problems (a figure that
 * is wrong, a date that has not happened, a span too big to review) block it;
 * softer ones (an empty day, items still awaiting release, no count) are
 * warnings the encoder has to acknowledge. Nothing here bypasses a rule the
 * single-day Finish already has: it calls the same closePeriod and saves the
 * same Daily Report snapshot a day at a time.
 */

/// A backlog bigger than this is not something one confirmation can honestly
/// cover: finish through an earlier date first, then the rest.
export const MAX_FINISH_SPAN_DAYS = 62;

const SHIFT_LABELS: Record<Shift, string> = { MORNING: "Morning", NIGHT: "Night" };
const DAY_MS = 86_400_000;

export interface FinishPlanPeriod {
  entryDate: string;
  shift: Shift;
  /// Products with a saved row on this page for the period.
  saved: number;
}

export interface FinishPlan {
  location: EntryLocation;
  throughDate: string;
  periods: FinishPlanPeriod[];
  blockers: string[];
  warnings: string[];
  canFinish: boolean;
}

interface InternalPlan extends FinishPlan {
  /// Per period "date:SHIFT" whose OTHER page needs nothing more (finished, or
  /// nothing saved) - those days get their report snapshot saved.
  settled: Set<string>;
}

const key = (entryDate: Date, shift: Shift) => `${toDateOnlyString(entryDate)}:${shift}`;
const order = (p: { entryDate: Date; shift: Shift }) => `${toDateOnlyString(p.entryDate)}:${p.shift === "MORNING" ? 0 : 1}`;

export async function planFinishThrough(throughDate: Date, location: EntryLocation, now: Date = new Date()): Promise<InternalPlan> {
  const blockers: string[] = [];
  const warnings: string[] = [];
  const through = toDateOnlyString(throughDate);
  const today = toDateOnlyString(now);
  const tomorrow = toDateOnlyString(new Date(now.getTime() + DAY_MS));

  const thisPage = location === "ONLINE" ? prisma.dailyOnlineStock : prisma.dailyOfflineStock;
  const otherPage = location === "ONLINE" ? prisma.dailyOfflineStock : prisma.dailyOnlineStock;

  if (through > tomorrow) blockers.push(`${through} has not happened yet.`);

  // Days finished before this feature (or ever) set the floor, exactly as the
  // in-order rule does: older unfinished entries predate Finish day.
  const first = await prisma.dayClosure.findFirst({ orderBy: { entryDate: "asc" }, select: { entryDate: true } });
  const range = { ...(first ? { gte: first.entryDate } : {}), lte: throughDate };

  const [rows, otherRows, closures] = await Promise.all([
    (thisPage as typeof prisma.dailyOnlineStock).groupBy({ by: ["entryDate", "shift"], where: { entryDate: range }, _count: { _all: true } }),
    (otherPage as typeof prisma.dailyOnlineStock).groupBy({ by: ["entryDate", "shift"], where: { entryDate: range } }),
    prisma.dayClosure.findMany({ where: { entryDate: range }, select: { entryDate: true, shift: true, onlineLocked: true, offlineLocked: true } }),
  ]);

  const lockedHere = new Set(closures.filter((c) => (location === "ONLINE" ? c.onlineLocked : c.offlineLocked)).map((c) => key(c.entryDate, c.shift)));
  const lockedThere = new Set(closures.filter((c) => (location === "ONLINE" ? c.offlineLocked : c.onlineLocked)).map((c) => key(c.entryDate, c.shift)));
  const otherHasRows = new Set(otherRows.map((r) => key(r.entryDate, r.shift)));

  const pending = rows
    .filter((r) => !lockedHere.has(key(r.entryDate, r.shift)))
    .sort((a, b) => order(a).localeCompare(order(b)));
  const periods: FinishPlanPeriod[] = pending.map((r) => ({
    entryDate: toDateOnlyString(r.entryDate),
    shift: r.shift,
    saved: (r as { _count: { _all: number } })._count._all,
  }));

  if (periods.length > 0) {
    const spanDays = Math.round((throughDate.getTime() - new Date(`${periods[0].entryDate}T00:00:00.000Z`).getTime()) / DAY_MS) + 1;
    if (spanDays > MAX_FINISH_SPAN_DAYS) {
      blockers.push(
        `That is ${spanDays} days of unfinished entries (from ${periods[0].entryDate}). Finish through an earlier date first - the limit is ${MAX_FINISH_SPAN_DAYS} days at a time.`,
      );
    }

    // A figure that cannot be right is never locked in. Saves already refuse
    // negative stock; a later carry-forward can still leave one behind.
    const negative = await (thisPage as typeof prisma.dailyOnlineStock).count({
      where: { entryDate: { gte: new Date(`${periods[0].entryDate}T00:00:00.000Z`), lte: throughDate }, remainingStock: { lt: 0 } },
    });
    if (negative > 0) blockers.push(`${negative} product row(s) end below zero stock in this range. Correct them before finishing.`);

    // Empty days inside the range: legitimate (nobody worked) or a missed day.
    const worked = new Set([...rows, ...otherRows].map((r) => toDateOnlyString(r.entryDate)));
    const gaps: string[] = [];
    for (let d = new Date(`${periods[0].entryDate}T00:00:00.000Z`); toDateOnlyString(d) <= through; d.setUTCDate(d.getUTCDate() + 1)) {
      if (!worked.has(toDateOnlyString(d))) gaps.push(toDateOnlyString(d));
    }
    if (gaps.length > 0) warnings.push(`No entries at all on ${gaps.length} day(s): ${gaps.slice(0, 6).join(", ")}${gaps.length > 6 ? ", ..." : ""}.`);

    // Awaiting-release goods are not stock and never block a finish - but they
    // must be seen, not forgotten.
    const awaiting = await prisma.pendingRelease.count({ where: { status: "AWAITING", location, madeDate: { lte: throughDate } } });
    if (awaiting > 0) warnings.push(`${awaiting} item(s) are still awaiting release. They are not part of this stock; release them on the day they become sellable.`);

    const counted = await prisma.manualCount.groupBy({
      by: ["entryDate", "shift"],
      where: { entryDate: { gte: new Date(`${periods[0].entryDate}T00:00:00.000Z`), lte: throughDate }, location },
    });
    const countedKeys = new Set(counted.map((c) => key(c.entryDate, c.shift)));
    const uncounted = periods.filter((p) => !countedKeys.has(`${p.entryDate}:${p.shift}`)).length;
    if (uncounted > 0) warnings.push(`${uncounted} period(s) have no manual count saved for this page.`);

    if (through >= today) warnings.push("This includes today's shifts, which may still be in progress.");
  }

  const settled = new Set(
    periods.map((p) => `${p.entryDate}:${p.shift}`).filter((k) => {
      const [date, shift] = k.split(":");
      const probe = key(new Date(`${date}T00:00:00.000Z`), shift as Shift);
      return lockedThere.has(probe) || !otherHasRows.has(probe);
    }),
  );

  return { location, throughDate: through, periods, blockers, warnings, canFinish: periods.length > 0 && blockers.length === 0, settled };
}

/// The plan as the API shows it (without the internal bookkeeping).
export async function previewFinishThrough(throughDate: Date, location: EntryLocation): Promise<FinishPlan> {
  const { settled: _settled, ...plan } = await planFinishThrough(throughDate, location);
  return plan;
}

export async function finishThrough(
  throughDate: Date,
  location: EntryLocation,
  userId: number | undefined,
  opts: { acknowledgeWarnings?: boolean } = {},
) {
  const plan = await planFinishThrough(throughDate, location);
  if (plan.periods.length === 0) return { finished: 0, periods: [], warnings: [], snapshots: [] as string[] };
  if (plan.blockers.length > 0) throw HttpError.badRequest(`Can't finish through ${plan.throughDate}: ${plan.blockers.join(" ")}`, plan);
  if (plan.warnings.length > 0 && !opts.acknowledgeWarnings) {
    throw HttpError.conflict("This finish has warnings that need to be acknowledged first.", plan);
  }

  // The reports only read, so they are built before the transaction opens and
  // never hold it up. One per date, for every date a settled period falls on.
  const snapshotDates = [...new Set([...plan.settled].map((k) => k.split(":")[0]))].sort();
  const reports = new Map<string, unknown>();
  for (const day of snapshotDates) reports.set(day, await buildDailyReport(new Date(`${day}T00:00:00.000Z`)));

  await prisma.$transaction(
    async (tx) => {
      for (const p of plan.periods) {
        await closePeriod(new Date(`${p.entryDate}T00:00:00.000Z`), p.shift, { entriesOnly: true, userId, location }, tx);
      }
      for (const day of snapshotDates) {
        await saveSnapshot(new Date(`${day}T00:00:00.000Z`), reports.get(day), userId, tx);
        await recordReportHistoryIn(tx, { type: "Daily Report", scope: day, route: `/daily-report?history=1&date=${day}`, section: "all" }, userId);
      }
    },
    { timeout: 120_000, maxWait: 10_000 },
  );
  broadcastRealtimeEvent();
  for (const day of snapshotDates) notifyDailyReportSaved(new Date(`${day}T00:00:00.000Z`));

  return {
    finished: plan.periods.length,
    periods: plan.periods.map((p) => `${p.entryDate} ${SHIFT_LABELS[p.shift]}`),
    warnings: plan.warnings,
    snapshots: snapshotDates,
  };
}
