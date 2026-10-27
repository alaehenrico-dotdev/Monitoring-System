import { getOnlineGrid } from "./dailyOnlineStock.service";
import { getOfflineGrid } from "./dailyOfflineStock.service";
import { getTotalStocksGrid } from "./totalStocks.service";
import { toDateOnlyString } from "../utils/date";
import { manualCountRepository } from "../repositories/manualCountRepository";
import { toNum } from "../utils/stockMath";
import { findFrozenSnapshot, snapshotMeta } from "./dailyReportSnapshot.service";

/// One audit (manual count) line of the report: what the system said, what was
/// counted, and the gap - the same figures as the Audit page.
export interface AuditReportRow {
  product: { category: string; sku: string | null; name: string };
  shift: "MORNING" | "NIGHT";
  location: "ONLINE" | "OFFLINE" | "TOTAL";
  systemRemainingStock: number;
  manualCount: number;
  variance: number;
  remarks: string | null;
  /// Approved by a supervisor (the Audit page's Publish).
  published: boolean;
  /// The first count of a product at a location seeds the system rather than
  /// auditing it, so it carries no variance.
  isOpeningBalance: boolean;
}

/// Every audit count saved for the date. Plain numbers and strings only, so it
/// survives being frozen into a snapshot as JSON.
export async function buildAudit(entryDate: Date): Promise<AuditReportRow[]> {
  const counts = await manualCountRepository.findAllForDateWithProduct(entryDate);
  return counts.map((c) => ({
    product: { category: c.product.category, sku: c.product.sku, name: c.product.name },
    shift: c.shift,
    location: c.location,
    systemRemainingStock: toNum(c.systemRemainingStock),
    manualCount: toNum(c.manualCount),
    variance: toNum(c.variance),
    remarks: c.remarks ?? null,
    published: c.publishedAt !== null,
    isOpeningBalance: c.isOpeningBalance,
  }));
}

/**
 * Section 4.8 - Daily Report: a printable/exportable view of a given date's
 * Online, Offline, and Total grids, laid out the same way as the current
 * Excel printout. This service only composes the read models above - it
 * holds no stock-calculation logic of its own.
 */
export async function buildDailyReport(entryDate: Date) {
  const [online, offline, total, audit] = await Promise.all([
    // The WHOLE day, one row per product: when a day has a Morning and a Night
    // sheet they are added together - the opening from the Morning sheet, every
    // movement and added column summed over both, the closing the Night sheet's
    // - so the report agrees with Daily Out, which counts both shifts. A day
    // with one sheet is that sheet. "always" (not the shifts setting) decides,
    // so the report, and the copy frozen from it, come out the same whichever
    // mode is on.
    getOnlineGrid(entryDate, "NIGHT", { combineSplitDay: "always" }),
    getOfflineGrid(entryDate, "NIGHT", { combineSplitDay: "always" }),
    getTotalStocksGrid(entryDate),
    buildAudit(entryDate),
  ]);

  return { date: toDateOnlyString(entryDate), online, offline, total, audit };
}

/// What the Daily Report endpoint serves: the frozen snapshot once the day has
/// been finished (so it can never change afterwards), the live figures
/// otherwise. `snapshot` tells the page which one it is looking at.
export async function getDailyReport(entryDate: Date) {
  const frozen = await findFrozenSnapshot(entryDate);
  if (frozen) {
    const payload = frozen.payload as unknown as Awaited<ReturnType<typeof buildDailyReport>>;
    // A report frozen before the Audit section existed has none stored; read the
    // day's counts as they stand so the section is never silently empty.
    return { ...payload, audit: payload.audit ?? (await buildAudit(entryDate)), snapshot: snapshotMeta(frozen) };
  }
  return { ...(await buildDailyReport(entryDate)), snapshot: null };
}
