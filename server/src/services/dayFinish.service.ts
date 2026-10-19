import { Shift } from "@prisma/client";
import { prisma } from "../lib/prisma";
import { HttpError } from "../utils/HttpError";
import { broadcastRealtimeEvent } from "../lib/realtime";
import { assertEarlierDaysFinished, closePeriod, isSideLocked, otherLocation, type EntryLocation } from "./dayLock.service";
import { buildDailyReport } from "./reports.service";
import { saveSnapshot } from "./dailyReportSnapshot.service";
import { recordReportHistoryIn } from "./reportHistory.service";
import { toDateOnlyString } from "../utils/date";
import { describeNegatives, findNegativeRows } from "./negativeStock.service";
import { logSystemEvent } from "./changeLog.service";

/// The shortest reason a supervisor may give when signing off negative stock.
const MIN_SIGNOFF_REASON = 3;

/// What an encoder is about to lock by finishing a page, so the confirmation
/// can say so: how many products have saved entries in each grid, and which
/// pages are already finished. A grid with none is usually the other encoder
/// not being done yet. `alreadyFinished` is about `location` when given, and
/// about the whole shift (both pages) when not.
export async function getFinishSummary(entryDate: Date, shift: Shift, location?: EntryLocation) {
  const [online, offline, total, closure, negatives] = await Promise.all([
    prisma.dailyOnlineStock.count({ where: { entryDate, shift } }),
    prisma.dailyOfflineStock.count({ where: { entryDate, shift } }),
    prisma.product.count({ where: { isActive: true } }),
    prisma.dayClosure.findUnique({ where: { entryDate_shift: { entryDate, shift } } }),
    location ? findNegativeRows(entryDate, shift, location) : Promise.resolve([]),
  ]);
  const onlineLocked = closure?.onlineLocked ?? false;
  const offlineLocked = closure?.offlineLocked ?? false;
  return {
    online: { saved: online, total },
    offline: { saved: offline, total },
    /// Products below zero on the asked-about page. Finishing needs a supervisor's
    /// sign-off while there are any.
    negatives,
    onlineLocked,
    offlineLocked,
    alreadyFinished: location ? isSideLocked(closure, location) : onlineLocked && offlineLocked,
  };
}

/**
 * The encoder's "Finish day" for ONE entry page (Online or Offline) of a date +
 * shift: freezes that page's grid only (Manual Counts stay open - see
 * assertPeriodOpen's `scope` - and so does the other page, whose own encoder
 * finishes it separately).
 *
 * The Daily Report snapshot is saved once the day is settled - the other page is
 * finished too, or has nothing saved at all - so it never captures a day that
 * is still being entered. It is saved in the same transaction as the lock, so
 * neither can exist without the other. Finishing the second page therefore
 * freezes the report, and until then the report stays live.
 *
 * Idempotent: finishing a page that is already locked changes nothing.
 */
export async function finishDay(
  entryDate: Date,
  shift: Shift,
  location: EntryLocation,
  userId?: number,
  /// A supervisor/admin may finish over negative stock by giving a reason.
  signOff: { allowed: boolean; reason?: string } = { allowed: false },
) {
  const summary = await getFinishSummary(entryDate, shift, location);
  if (summary.alreadyFinished) return { ...summary, finished: false };
  // Days are finished in order, per page.
  await assertEarlierDaysFinished(entryDate, prisma, location);
  const mine = location === "ONLINE" ? summary.online : summary.offline;
  if (mine.saved === 0) {
    const page = location === "ONLINE" ? "Online" : "Offline";
    throw HttpError.badRequest(`Nothing has been saved on the ${page} page for this shift yet, so there is nothing to finish.`);
  }

  // Negative stock is allowed while entering (an Out can come before its In) but
  // is not locked in silently: an encoder has to fix it, a supervisor may sign it off.
  if (summary.negatives.length > 0) {
    const what = `${summary.negatives.length} product${summary.negatives.length === 1 ? "" : "s"} end below zero stock: ${describeNegatives(summary.negatives)}.`;
    if (!signOff.allowed) {
      throw HttpError.conflict(`${what} Enter the missing In figures, or ask a supervisor to sign off before finishing.`, { negatives: summary.negatives });
    }
    const reason = signOff.reason?.trim() ?? "";
    if (reason.length < MIN_SIGNOFF_REASON) {
      throw HttpError.badRequest(`${what} Give a reason to sign off finishing with negative stock.`, { negatives: summary.negatives });
    }
    await logSystemEvent(
      "negative_stock_signoff",
      { entryDate: toDateOnlyString(entryDate), shift, location, reason, products: summary.negatives.map((n) => ({ productId: n.productId, remainingStock: n.remainingStock })) },
      userId,
    );
  }

  const other = otherLocation(location);
  const otherSaved = (other === "ONLINE" ? summary.online : summary.offline).saved;
  const otherLocked = other === "ONLINE" ? summary.onlineLocked : summary.offlineLocked;
  const settled = otherLocked || otherSaved === 0;

  // The snapshot is built before the transaction (it only reads).
  const report = settled ? await buildDailyReport(entryDate) : null;
  await prisma.$transaction(async (tx) => {
    await closePeriod(entryDate, shift, { entriesOnly: true, userId, location }, tx);
    if (!report) return;
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
  return {
    ...summary,
    onlineLocked: location === "ONLINE" ? true : summary.onlineLocked,
    offlineLocked: location === "OFFLINE" ? true : summary.offlineLocked,
    alreadyFinished: true,
    finished: true,
    reportSaved: settled,
  };
}
