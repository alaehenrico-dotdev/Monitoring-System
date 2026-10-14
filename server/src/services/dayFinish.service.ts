import { Shift } from "@prisma/client";
import { prisma } from "../lib/prisma";
import { HttpError } from "../utils/HttpError";
import { broadcastRealtimeEvent } from "../lib/realtime";
import { assertEarlierDaysFinished, closePeriod } from "./dayLock.service";
import { buildDailyReport } from "./reports.service";
import { saveSnapshot } from "./dailyReportSnapshot.service";
import { recordReportHistoryIn } from "./reportHistory.service";
import { toDateOnlyString } from "../utils/date";

/// What an encoder is about to lock by finishing a shift, so the confirmation
/// can say so: how many products have saved entries in each grid. A grid with
/// none is usually the other encoder not being done yet.
export async function getFinishSummary(entryDate: Date, shift: Shift) {
  const [online, offline, total, closure] = await Promise.all([
    prisma.dailyOnlineStock.count({ where: { entryDate, shift } }),
    prisma.dailyOfflineStock.count({ where: { entryDate, shift } }),
    prisma.product.count({ where: { isActive: true } }),
    prisma.dayClosure.findUnique({ where: { entryDate_shift: { entryDate, shift } } }),
  ]);
  return {
    online: { saved: online, total },
    offline: { saved: offline, total },
    alreadyFinished: closure?.isClosed ?? false,
  };
}

/**
 * The encoder's "Finish day" for one date + shift: freezes the Online/Offline
 * entry grids (Manual Counts stay open - see assertPeriodOpen's `scope`) and
 * saves the Daily Report as it stands, so the day can no longer be edited and
 * the report for it can never change.
 *
 * Idempotent: finishing a shift that is already locked changes nothing. The
 * snapshot is built before the transaction (it only reads), then written in the
 * same transaction as the lock so neither can exist without the other.
 */
export async function finishDay(entryDate: Date, shift: Shift, userId?: number) {
  const summary = await getFinishSummary(entryDate, shift);
  if (summary.alreadyFinished) return { ...summary, finished: false };
  // Days are finished in order.
  await assertEarlierDaysFinished(entryDate);
  if (summary.online.saved + summary.offline.saved === 0) {
    throw HttpError.badRequest("Nothing has been saved for this shift yet, so there is nothing to finish.");
  }

  const report = await buildDailyReport(entryDate);
  await prisma.$transaction(async (tx) => {
    await closePeriod(entryDate, shift, { entriesOnly: true, userId }, tx);
    await saveSnapshot(entryDate, report, userId, tx);
    // The saved report is listed in Daily Report History (and the Change Log),
    // where it can be opened and downloaded again at any time.
    const day = toDateOnlyString(entryDate);
    await recordReportHistoryIn(
      tx,
      { type: "Daily Report", scope: day, route: `/daily-report?history=1&date=${day}`, section: "all" },
      userId,
    );
  });
  broadcastRealtimeEvent();
  return { ...summary, alreadyFinished: true, finished: true };
}
