import { productRepository } from "../repositories/productRepository";
import { dailyOnlineStockRepository } from "../repositories/dailyOnlineStockRepository";
import { dailyOfflineStockRepository } from "../repositories/dailyOfflineStockRepository";
import { manualCountRepository } from "../repositories/manualCountRepository";
import { toNum } from "../utils/stockMath";

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

  const [onlineRows, offlineRows, manualCounts] = await Promise.all([
    dailyOnlineStockRepository.findAllForDate(entryDate),
    dailyOfflineStockRepository.findAllForDate(entryDate),
    manualCountRepository.findForTotals(entryDate),
  ]);

  const onlineByProduct = new Map(onlineRows.map((r) => [r.productId, r]));
  const offlineByProduct = new Map(offlineRows.map((r) => [r.productId, r]));
  const manualByProduct = new Map<number, typeof manualCounts>();
  for (const mc of manualCounts) {
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
    const totalVariance = totalManualCount === null ? null : totalRemainingStock - totalManualCount;

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
