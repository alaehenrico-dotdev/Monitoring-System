import { prisma } from "../lib/prisma";
import { buildDailyReport } from "./reports.service";
import { findFrozenSnapshot, saveSnapshot } from "./dailyReportSnapshot.service";
import { notifyDailyReportSaved } from "../lib/reportSaved";

/// Key-order-independent string form: MySQL's JSON column does not preserve the
/// order keys were written in, so two equal payloads can stringify differently.
export function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonical(v)}`).join(",")}}`;
  }
  return JSON.stringify(value) ?? "null";
}

/**
 * Re-saves the frozen Daily Report of every finished day from `fromDate` on
 * (just `fromDate` itself without `cascade`), so an approved adjustment to a
 * finished day shows in that day's report instead of leaving the old figures
 * frozen next to a changed ledger. The previous payload is kept in full in the
 * change log (see saveSnapshot), so nothing a day once reported is lost.
 *
 * Only days that are actually frozen are touched: an admin-unlocked day has no
 * served snapshot, and finishing it again builds a fresh one anyway.
 * Returns the dates that were refreshed.
 */
export async function refreshFrozenSnapshots(fromDate: Date, opts: { cascade?: boolean; userId?: number } = {}): Promise<Date[]> {
  const candidates = await prisma.dailyReportSnapshot.findMany({
    where: { entryDate: opts.cascade ? { gte: fromDate } : fromDate },
    select: { entryDate: true },
    orderBy: { entryDate: "asc" },
  });
  const refreshed: Date[] = [];
  for (const { entryDate } of candidates) {
    const frozen = await findFrozenSnapshot(entryDate);
    if (!frozen) continue;
    // buildDailyReport reads the live ledger, never the snapshot, so this is the
    // day's current state.
    const report = await buildDailyReport(entryDate);
    // A cascade passes over days the change never reached: leave those alone
    // rather than log a re-save that changed nothing.
    if (canonical(JSON.parse(JSON.stringify(report))) === canonical(frozen.payload)) continue;
    await prisma.$transaction((tx) => saveSnapshot(entryDate, report, opts.userId, tx));
    refreshed.push(entryDate);
    // A corrected day's file in Drive follows its corrected report.
    notifyDailyReportSaved(entryDate);
  }
  return refreshed;
}
