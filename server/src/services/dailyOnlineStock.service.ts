import { dailyOnlineStockRepository } from "../repositories/dailyOnlineStockRepository";
import { dailyOfflineStockRepository } from "../repositories/dailyOfflineStockRepository";
import { productRepository } from "../repositories/productRepository";
import { recordChange } from "./changeLog.service";
import { calculateOfflineRemaining, calculateOfflineStock, calculateOnlineRemaining, calculateOnlineStock, toNum } from "../utils/stockMath";

const TABLE = "daily_online_stock";
const OFFLINE_TABLE = "daily_offline_stock";

export interface OnlineEntryInput {
  stockInOffToOl?: number;
  stockOutOlToOff?: number;
  productionIn?: number;
  fulfillmentOut?: number;
  rts?: number;
}

/// Section 4.6 - auto carry-forward (delegated to the repository, which owns
/// the "most recent prior date" query).
export function computeOpeningStock(productId: number, entryDate: Date): Promise<number> {
  return dailyOnlineStockRepository.getOpeningStock(productId, entryDate);
}

function calculate(opening: number, input: Required<OnlineEntryInput>) {
  const onlineStock = calculateOnlineStock(opening, input.stockInOffToOl, input.stockOutOlToOff);
  const remainingStock = calculateOnlineRemaining(onlineStock, input.productionIn, input.fulfillmentOut, input.rts);
  return { onlineStock, remainingStock };
}

/// One grid row per active product for the given date - persisted rows as-is,
/// missing rows as a "virtual" preview using the carried-forward opening stock
/// (Section 3.1: the grid always shows every product in the master list).
///
/// Opening stocks for every missing row are fetched in one batched call
/// rather than one query per product - on a fresh date, most/all of the
/// ~60 products in the master list won't have a row yet, so the naive
/// per-product await turned every grid load into an N+1 query storm.
export async function getOnlineGrid(entryDate: Date) {
  const products = await productRepository.findActive();
  const rows = await dailyOnlineStockRepository.findAllForDate(entryDate);
  const rowByProduct = new Map(rows.map((r) => [r.productId, r]));

  const missingProductIds = products.filter((p) => !rowByProduct.has(p.id)).map((p) => p.id);
  const openingStockByProduct = await dailyOnlineStockRepository.getOpeningStocksForProducts(missingProductIds, entryDate);

  return products.map((product) => {
    const existing = rowByProduct.get(product.id);
    if (existing) return { product, entry: existing, isSaved: true };

    const openingStock = openingStockByProduct.get(product.id) ?? 0;
    const zero: Required<OnlineEntryInput> = {
      stockInOffToOl: 0,
      stockOutOlToOff: 0,
      productionIn: 0,
      fulfillmentOut: 0,
      rts: 0,
    };
    const { onlineStock, remainingStock } = calculate(openingStock, zero);
    return {
      product,
      entry: { productId: product.id, entryDate, openingStock, ...zero, onlineStock, remainingStock },
      isSaved: false,
    };
  });
}

/// Encoder-facing upsert for one product/date cell row (Section 4.2).
export async function saveOnlineEntry(productId: number, entryDate: Date, input: OnlineEntryInput, userId?: number) {
  const existing = await dailyOnlineStockRepository.findByProductAndDate(productId, entryDate);

  const openingStock = existing ? toNum(existing.openingStock) : await computeOpeningStock(productId, entryDate);
  const merged: Required<OnlineEntryInput> = {
    stockInOffToOl: input.stockInOffToOl ?? toNum(existing?.stockInOffToOl),
    stockOutOlToOff: input.stockOutOlToOff ?? toNum(existing?.stockOutOlToOff),
    productionIn: input.productionIn ?? toNum(existing?.productionIn),
    fulfillmentOut: input.fulfillmentOut ?? toNum(existing?.fulfillmentOut),
    rts: input.rts ?? toNum(existing?.rts),
  };
  const { onlineStock, remainingStock } = calculate(openingStock, merged);

  const data = { productId, entryDate, openingStock, ...merged, onlineStock, remainingStock, encodedById: userId };
  const saved = await dailyOnlineStockRepository.upsert(existing?.id, data);

  await recordChange({
    tableName: TABLE,
    recordId: saved.id,
    action: existing ? "UPDATE" : "CREATE",
    changedById: userId,
    oldValue: existing,
    newValue: saved,
  });

  // Section 4.3 "key change from Excel" - a transfer entered once here is
  // mirrored onto the Offline table by writing straight to its repository
  // (not by calling the Offline service), so the two stock services never
  // depend on each other.
  await mirrorTransferToOffline(
    productId,
    entryDate,
    { stockOutOffToOl: merged.stockInOffToOl, stockInOlToOff: merged.stockOutOlToOff },
    userId
  );

  return saved;
}

async function mirrorTransferToOffline(
  productId: number,
  entryDate: Date,
  mirrored: { stockOutOffToOl: number; stockInOlToOff: number },
  userId?: number
) {
  const existing = await dailyOfflineStockRepository.findByProductAndDate(productId, entryDate);
  const openingStock = existing ? toNum(existing.openingStock) : await dailyOfflineStockRepository.getOpeningStock(productId, entryDate);

  const merged = {
    stockInOlToOff: mirrored.stockInOlToOff,
    stockOutOffToOl: mirrored.stockOutOffToOl,
    productionIn: toNum(existing?.productionIn),
    deliveryOut: toNum(existing?.deliveryOut),
    backloads: toNum(existing?.backloads),
  };
  const offlineStock = calculateOfflineStock(openingStock, merged.stockInOlToOff, merged.stockOutOffToOl);
  const remainingStock = calculateOfflineRemaining(offlineStock, merged.productionIn, merged.deliveryOut, merged.backloads);

  const data = {
    productId,
    entryDate,
    openingStock,
    ...merged,
    offlineStock,
    remainingStock,
    // A mirrored write doesn't reassign whose entry this is; keep the
    // existing encoder attribution if the row already exists.
    encodedById: existing?.encodedById ?? userId,
  };
  const saved = await dailyOfflineStockRepository.upsert(existing?.id, data);

  await recordChange({
    tableName: OFFLINE_TABLE,
    recordId: saved.id,
    action: existing ? "UPDATE" : "CREATE",
    changedById: userId,
    oldValue: existing,
    newValue: saved,
  });
}

/// Section 4.7 - a saved Receipt can post its quantities straight into that
/// date's Online Fulfillment (Out).
export async function addFulfillmentFromReceipt(productId: number, entryDate: Date, additionalQty: number, userId?: number) {
  const existing = await dailyOnlineStockRepository.findByProductAndDate(productId, entryDate);
  const currentFulfillment = toNum(existing?.fulfillmentOut);
  await saveOnlineEntry(productId, entryDate, { fulfillmentOut: currentFulfillment + additionalQty }, userId);
}
