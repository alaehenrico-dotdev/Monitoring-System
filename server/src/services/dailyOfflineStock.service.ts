import { dailyOfflineStockRepository } from "../repositories/dailyOfflineStockRepository";
import { dailyOnlineStockRepository } from "../repositories/dailyOnlineStockRepository";
import { productRepository } from "../repositories/productRepository";
import { recordChange } from "./changeLog.service";
import { HttpError } from "../utils/HttpError";
import { calculateOfflineRemaining, calculateOfflineStock, calculateOnlineRemaining, calculateOnlineStock, toNum } from "../utils/stockMath";

const TABLE = "daily_offline_stock";
const ONLINE_TABLE = "daily_online_stock";

export interface OfflineEntryInput {
  stockInOlToOff?: number;
  stockOutOffToOl?: number;
  productionIn?: number;
  deliveryOut?: number;
  backloads?: number;
  /// See OnlineEntryInput's own doc comment (dailyOnlineStock.service.ts) -
  /// same reasoning, same CSV-import-only exception to auto-carry-forward.
  openingStock?: number;
}

/// Section 4.6 - same carry-forward principle as the Online table.
export function computeOpeningStock(productId: number, entryDate: Date): Promise<number> {
  return dailyOfflineStockRepository.getOpeningStock(productId, entryDate);
}

function calculate(opening: number, input: Required<Omit<OfflineEntryInput, "openingStock">>) {
  const offlineStock = calculateOfflineStock(opening, input.stockInOlToOff, input.stockOutOffToOl);
  const remainingStock = calculateOfflineRemaining(offlineStock, input.productionIn, input.deliveryOut, input.backloads);
  return { offlineStock, remainingStock };
}

/// Same N+1 avoidance as getOnlineGrid - opening stocks for every unsaved
/// row are fetched in one batched call instead of one query per product.
export async function getOfflineGrid(entryDate: Date) {
  const products = await productRepository.findActive();
  const rows = await dailyOfflineStockRepository.findAllForDate(entryDate);
  const rowByProduct = new Map(rows.map((r) => [r.productId, r]));

  const missingProductIds = products.filter((p) => !rowByProduct.has(p.id)).map((p) => p.id);
  const openingStockByProduct = await dailyOfflineStockRepository.getOpeningStocksForProducts(missingProductIds, entryDate);

  return products.map((product) => {
    const existing = rowByProduct.get(product.id);
    if (existing) return { product, entry: existing, isSaved: true };

    const openingStock = openingStockByProduct.get(product.id) ?? 0;
    const zero: Required<Omit<OfflineEntryInput, "openingStock">> = {
      stockInOlToOff: 0,
      stockOutOffToOl: 0,
      productionIn: 0,
      deliveryOut: 0,
      backloads: 0,
    };
    const { offlineStock, remainingStock } = calculate(openingStock, zero);
    return {
      product,
      entry: { productId: product.id, entryDate, openingStock, ...zero, offlineStock, remainingStock },
      isSaved: false,
    };
  });
}

/// Encoder-facing upsert for one product/date cell row (Section 4.3).
export async function saveOfflineEntry(productId: number, entryDate: Date, input: OfflineEntryInput, userId?: number) {
  const product = await productRepository.findActiveById(productId);
  if (!product) throw HttpError.notFound("Active product not found");
  const existing = await dailyOfflineStockRepository.findByProductAndDate(productId, entryDate);

  const openingStock =
    input.openingStock ?? (existing ? toNum(existing.openingStock) : await computeOpeningStock(productId, entryDate));
  const merged: Required<Omit<OfflineEntryInput, "openingStock">> = {
    stockInOlToOff: input.stockInOlToOff ?? toNum(existing?.stockInOlToOff),
    stockOutOffToOl: input.stockOutOffToOl ?? toNum(existing?.stockOutOffToOl),
    productionIn: input.productionIn ?? toNum(existing?.productionIn),
    deliveryOut: input.deliveryOut ?? toNum(existing?.deliveryOut),
    backloads: input.backloads ?? toNum(existing?.backloads),
  };
  const { offlineStock, remainingStock } = calculate(openingStock, merged);

  const data = { productId, entryDate, openingStock, ...merged, offlineStock, remainingStock, encodedById: userId };
  const saved = await dailyOfflineStockRepository.upsert(existing?.id, data);

  await recordChange({
    tableName: TABLE,
    recordId: saved.id,
    action: existing ? "UPDATE" : "CREATE",
    changedById: userId,
    oldValue: existing,
    newValue: saved,
  });

  // Section 4.3 - mirror this transfer back onto the Online table via its
  // repository directly, keeping the two stock services independent of
  // each other (see dailyOnlineStock.service.ts for the reverse direction).
  await mirrorTransferToOnline(
    productId,
    entryDate,
    { stockInOffToOl: merged.stockOutOffToOl, stockOutOlToOff: merged.stockInOlToOff },
    userId
  );

  return saved;
}

async function mirrorTransferToOnline(
  productId: number,
  entryDate: Date,
  mirrored: { stockInOffToOl: number; stockOutOlToOff: number },
  userId?: number
) {
  const existing = await dailyOnlineStockRepository.findByProductAndDate(productId, entryDate);

  // Same guard as the reverse direction in dailyOnlineStock.service.ts -
  // saveOfflineEntry mirrors unconditionally after every save, so without
  // this check an edit to e.g. Delivery (Out) alone would still rewrite and
  // re-log the online row even though nothing about the transfer changed.
  if (existing && toNum(existing.stockInOffToOl) === mirrored.stockInOffToOl && toNum(existing.stockOutOlToOff) === mirrored.stockOutOlToOff) {
    return;
  }
  if (!existing && mirrored.stockInOffToOl === 0 && mirrored.stockOutOlToOff === 0) {
    return; // nothing has actually transferred yet - don't create a blank row just to mirror zeros
  }

  const openingStock = existing ? toNum(existing.openingStock) : await dailyOnlineStockRepository.getOpeningStock(productId, entryDate);

  const merged = {
    stockInOffToOl: mirrored.stockInOffToOl,
    stockOutOlToOff: mirrored.stockOutOlToOff,
    productionIn: toNum(existing?.productionIn),
    fulfillmentOut: toNum(existing?.fulfillmentOut),
    rts: toNum(existing?.rts),
  };
  const onlineStock = calculateOnlineStock(openingStock, merged.stockInOffToOl, merged.stockOutOlToOff);
  const remainingStock = calculateOnlineRemaining(onlineStock, merged.productionIn, merged.fulfillmentOut, merged.rts);

  const data = {
    productId,
    entryDate,
    openingStock,
    ...merged,
    onlineStock,
    remainingStock,
    encodedById: existing?.encodedById ?? userId,
  };
  const saved = await dailyOnlineStockRepository.upsert(existing?.id, data);

  await recordChange({
    tableName: ONLINE_TABLE,
    recordId: saved.id,
    action: existing ? "UPDATE" : "CREATE",
    changedById: userId,
    oldValue: existing,
    newValue: saved,
  });
}
