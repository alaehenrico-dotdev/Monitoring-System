import { StockLocation } from "@prisma/client";
import { manualCountRepository } from "../repositories/manualCountRepository";
import { dailyOnlineStockRepository } from "../repositories/dailyOnlineStockRepository";
import { dailyOfflineStockRepository } from "../repositories/dailyOfflineStockRepository";
import { productRepository } from "../repositories/productRepository";
import { recordChange } from "./changeLog.service";
import { calculateVariance, toNum } from "../utils/stockMath";
import { HttpError } from "../utils/HttpError";

const TABLE = "manual_counts";

/// Section 4.4 - Variance = System Remaining Stock - Manual Count. The system
/// figure is always pulled fresh from the matching daily table at save time,
/// never typed, so it can't silently disappear the way an overwritten
/// spreadsheet cell can (Section 2.1).
export async function getSystemRemainingStock(productId: number, entryDate: Date, location: StockLocation) {
  if (location === "ONLINE") {
    const row = await dailyOnlineStockRepository.findByProductAndDate(productId, entryDate);
    return toNum(row?.remainingStock);
  }
  if (location === "OFFLINE") {
    const row = await dailyOfflineStockRepository.findByProductAndDate(productId, entryDate);
    return toNum(row?.remainingStock);
  }
  // TOTAL - Online + Offline remaining stock combined (Section 4.5).
  const [online, offline] = await Promise.all([
    dailyOnlineStockRepository.findByProductAndDate(productId, entryDate),
    dailyOfflineStockRepository.findByProductAndDate(productId, entryDate),
  ]);
  return toNum(online?.remainingStock) + toNum(offline?.remainingStock);
}

export async function saveManualCount(
  productId: number,
  entryDate: Date,
  location: StockLocation,
  manualCount: number,
  userId?: number
) {
  const product = await productRepository.findActiveById(productId);
  if (!product) throw HttpError.notFound("Active product not found");
  const systemRemainingStock = await getSystemRemainingStock(productId, entryDate, location);
  const variance = calculateVariance(systemRemainingStock, manualCount);

  const existing = await manualCountRepository.findOne(productId, entryDate, location);
  const data = { productId, entryDate, location, systemRemainingStock, manualCount, variance, countedById: userId };
  const saved = await manualCountRepository.upsert(existing?.id, data);

  await recordChange({
    tableName: TABLE,
    recordId: saved.id,
    action: existing ? "UPDATE" : "CREATE",
    changedById: userId,
    oldValue: existing,
    newValue: saved,
  });

  return saved;
}

/// For a TOTAL grid, the naive per-product getSystemRemainingStock call
/// meant up to two extra queries (online + offline) per unsaved product -
/// worse than the online/offline grids' N+1, since it's effectively 2N+1.
/// This batches the daily table(s) this location actually needs into one
/// fetch each, then computes every product's figure from those in-memory
/// maps instead of querying per product.
export async function getManualCountGrid(entryDate: Date, location: StockLocation) {
  const products = await productRepository.findActive();
  const rows = await manualCountRepository.findAllForDateAndLocation(entryDate, location);
  const rowByProduct = new Map(rows.map((r) => [r.productId, r]));

  const needsOnline = location === "ONLINE" || location === "TOTAL";
  const needsOffline = location === "OFFLINE" || location === "TOTAL";
  const [onlineRows, offlineRows] = await Promise.all([
    needsOnline ? dailyOnlineStockRepository.findAllForDate(entryDate) : Promise.resolve([]),
    needsOffline ? dailyOfflineStockRepository.findAllForDate(entryDate) : Promise.resolve([]),
  ]);
  const onlineByProduct = new Map(onlineRows.map((r) => [r.productId, r]));
  const offlineByProduct = new Map(offlineRows.map((r) => [r.productId, r]));

  function systemRemainingStockFor(productId: number): number {
    if (location === "ONLINE") return toNum(onlineByProduct.get(productId)?.remainingStock);
    if (location === "OFFLINE") return toNum(offlineByProduct.get(productId)?.remainingStock);
    return toNum(onlineByProduct.get(productId)?.remainingStock) + toNum(offlineByProduct.get(productId)?.remainingStock);
  }

  return products.map((product) => {
    const existing = rowByProduct.get(product.id);
    if (existing) return { product, entry: existing, isSaved: true, isFlagged: Number(existing.variance) !== 0 };

    const systemRemainingStock = systemRemainingStockFor(product.id);
    return {
      product,
      entry: { productId: product.id, entryDate, location, systemRemainingStock, manualCount: null, variance: null },
      isSaved: false,
      isFlagged: false,
    };
  });
}

/// Section 4.8 - Variance Report, filterable by product/category/location,
/// across a date range, to spot recurring problem SKUs (Toyo Mansi, Oyster
/// Sauce A per Section 4.4).
export async function getVarianceReport(filters: {
  startDate: Date;
  endDate: Date;
  productId?: number;
  category?: string;
  location?: StockLocation;
  flaggedOnly?: boolean;
}) {
  if (filters.startDate > filters.endDate) throw HttpError.badRequest("startDate must be before endDate");

  const rows = await manualCountRepository.findForVarianceReport(filters);
  return filters.flaggedOnly === false ? rows : rows.filter((r) => Number(r.variance) !== 0);
}
