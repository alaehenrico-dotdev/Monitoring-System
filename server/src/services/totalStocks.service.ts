import { Shift } from "@prisma/client";
import { productRepository } from "../repositories/productRepository";
import { dailyOnlineStockRepository } from "../repositories/dailyOnlineStockRepository";
import { dailyOfflineStockRepository } from "../repositories/dailyOfflineStockRepository";
import { manualCountRepository } from "../repositories/manualCountRepository";
import { calculateVariance, toNum } from "../utils/stockMath";

/// Online/Offline/Manual Count entries are now per-shift (Morning, Night),
/// but Total Stocks is still a single per-date snapshot rather than
/// exposing its own shift selector - this collapses whichever shift(s) have
/// actually been saved for the date down to one row per key, preferring
/// Night whenever both exist since it's the later, more up-to-date figure
/// for that day.
function collapseToLatestShift<T extends { shift: Shift }>(rows: T[], keyOf: (row: T) => string | number): Map<string | number, T> {
  const byKey = new Map<string | number, T>();
  for (const row of rows) {
    const key = keyOf(row);
    const current = byKey.get(key);
    if (!current || row.shift === "NIGHT") byKey.set(key, row);
  }
  return byKey;
}

/**
 * Section 4.5 / 5.5 - total_stocks is not a manually-entered table but a
 * read-only, always-current view: Online Remaining Stock + Offline Remaining
 * Stock per product/date, plus the combined manual count/variance. Because
 * it's calculated from the same records as the Online and Offline entries,
 * it cannot fall out of sync with them the way a separately-maintained sheet
 * can (Section 2.1 "No single source of truth").
 */
export async function getTotalStocksGrid(entryDate: Date) {
  const products = await productRepository.findActive();

  const [onlineRowsMorning, onlineRowsNight, offlineRowsMorning, offlineRowsNight, manualCounts] = await Promise.all([
    dailyOnlineStockRepository.findAllForDate(entryDate, "MORNING"),
    dailyOnlineStockRepository.findAllForDate(entryDate, "NIGHT"),
    dailyOfflineStockRepository.findAllForDate(entryDate, "MORNING"),
    dailyOfflineStockRepository.findAllForDate(entryDate, "NIGHT"),
    manualCountRepository.findForTotals(entryDate),
  ]);

  const onlineByProduct = collapseToLatestShift([...onlineRowsMorning, ...onlineRowsNight], (r) => r.productId);
  const offlineByProduct = collapseToLatestShift([...offlineRowsMorning, ...offlineRowsNight], (r) => r.productId);
  // Two shifts can each have saved a count for the same (product, location) -
  // collapse those down to one row per (product, location) first, same as
  // online/offline above, before grouping by product.
  const collapsedManualCounts = collapseToLatestShift(manualCounts, (mc) => `${mc.productId}:${mc.location}`).values();
  const manualByProduct = new Map<number, typeof manualCounts>();
  for (const mc of collapsedManualCounts) {
    const list = manualByProduct.get(mc.productId) ?? [];
    list.push(mc);
    manualByProduct.set(mc.productId, list);
  }

  return products.map((product) => {
    const online = onlineByProduct.get(product.id);
    const offline = offlineByProduct.get(product.id);
    const totalRemainingStock = toNum(online?.remainingStock) + toNum(offline?.remainingStock);

    const counts = manualByProduct.get(product.id) ?? [];
    const totalCount = counts.find((count) => count.location === "TOTAL");
    const locationCount = counts.filter((count) => count.location !== "TOTAL");
    const totalManualCount = totalCount
      ? toNum(totalCount.manualCount)
      : locationCount.length
        ? locationCount.reduce((sum, c) => sum + toNum(c.manualCount), 0)
        : null;
    // Same formula as Manual Count's own variance (manualCounts.service.ts) -
    // shared via calculateVariance rather than re-derived here, so the two
    // can never drift onto different sign conventions.
    const totalVariance = totalManualCount === null ? null : calculateVariance(totalRemainingStock, totalManualCount);

    return {
      product,
      onlineRemainingStock: toNum(online?.remainingStock),
      offlineRemainingStock: toNum(offline?.remainingStock),
      totalRemainingStock,
      totalManualCount,
      totalVariance,
    };
  });
}
