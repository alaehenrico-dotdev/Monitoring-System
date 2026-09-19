import { Shift } from "@prisma/client";
import { dailyOnlineStockRepository } from "../repositories/dailyOnlineStockRepository";
import { dailyOfflineStockRepository } from "../repositories/dailyOfflineStockRepository";
import { productRepository } from "../repositories/productRepository";
import { recordChange } from "./changeLog.service";
import { HttpError } from "../utils/HttpError";
import { calculateOfflineRemaining, calculateOfflineStock, calculateOnlineRemaining, calculateOnlineStock, toNum } from "../utils/stockMath";

const TABLE = "daily_online_stock";
const OFFLINE_TABLE = "daily_offline_stock";

export interface OnlineEntryInput {
  stockInOffToOl?: number;
  stockOutOlToOff?: number;
  productionIn?: number;
  fulfillmentOut?: number;
  rts?: number;
  /// Not part of the normal encoder-facing edit (Section 4.6 auto-carries
  /// this forward from the prior shift's Remaining Stock instead) - only
  /// meant for a CSV import seeding a real starting balance on a product's
  /// very first date, where there's nothing to carry forward from yet.
  openingStock?: number;
}

/// Section 4.6 - auto carry-forward (delegated to the repository, which owns
/// the "immediately preceding shift" query).
export function computeOpeningStock(productId: number, entryDate: Date, shift: Shift): Promise<number> {
  return dailyOnlineStockRepository.getOpeningStock(productId, entryDate, shift);
}

function calculate(opening: number, input: Required<Omit<OnlineEntryInput, "openingStock">>) {
  const onlineStock = calculateOnlineStock(opening, input.stockInOffToOl, input.stockOutOlToOff);
  const remainingStock = calculateOnlineRemaining(onlineStock, input.productionIn, input.fulfillmentOut, input.rts);
  return { onlineStock, remainingStock };
}

/// One grid row per active product for the given date/shift - persisted rows
/// as-is, missing rows as a "virtual" preview using the carried-forward
/// opening stock (Section 3.1: the grid always shows every product in the
/// master list).
///
/// Opening stocks for every missing row are fetched in one batched call
/// rather than one query per product - on a fresh shift, most/all of the
/// ~60 products in the master list won't have a row yet, so the naive
/// per-product await turned every grid load into an N+1 query storm.
export async function getOnlineGrid(entryDate: Date, shift: Shift) {
  const products = await productRepository.findActive();
  const rows = await dailyOnlineStockRepository.findAllForDate(entryDate, shift);
  const rowByProduct = new Map(rows.map((r) => [r.productId, r]));

  const missingProductIds = products.filter((p) => !rowByProduct.has(p.id)).map((p) => p.id);
  const openingStockByProduct = await dailyOnlineStockRepository.getOpeningStocksForProducts(missingProductIds, entryDate, shift);

  return products.map((product) => {
    const existing = rowByProduct.get(product.id);
    if (existing) return { product, entry: existing, isSaved: true };

    const openingStock = openingStockByProduct.get(product.id) ?? 0;
    const zero: Required<Omit<OnlineEntryInput, "openingStock">> = {
      stockInOffToOl: 0,
      stockOutOlToOff: 0,
      productionIn: 0,
      fulfillmentOut: 0,
      rts: 0,
    };
    const { onlineStock, remainingStock } = calculate(openingStock, zero);
    return {
      product,
      entry: { productId: product.id, entryDate, shift, openingStock, ...zero, onlineStock, remainingStock },
      isSaved: false,
    };
  });
}

/// Encoder-facing upsert for one product/date/shift cell row (Section 4.2).
export async function saveOnlineEntry(productId: number, entryDate: Date, shift: Shift, input: OnlineEntryInput, userId?: number) {
  const product = await productRepository.findActiveById(productId);
  if (!product) throw HttpError.notFound("Active product not found");
  const existing = await dailyOnlineStockRepository.findByProductAndDate(productId, entryDate, shift);

  const openingStock =
    input.openingStock ?? (existing ? toNum(existing.openingStock) : await computeOpeningStock(productId, entryDate, shift));
  const merged: Required<Omit<OnlineEntryInput, "openingStock">> = {
    stockInOffToOl: input.stockInOffToOl ?? toNum(existing?.stockInOffToOl),
    stockOutOlToOff: input.stockOutOlToOff ?? toNum(existing?.stockOutOlToOff),
    productionIn: input.productionIn ?? toNum(existing?.productionIn),
    fulfillmentOut: input.fulfillmentOut ?? toNum(existing?.fulfillmentOut),
    rts: input.rts ?? toNum(existing?.rts),
  };
  const { onlineStock, remainingStock } = calculate(openingStock, merged);

  const data = { productId, entryDate, shift, openingStock, ...merged, onlineStock, remainingStock, encodedById: userId };
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
  // depend on each other. Mirrored into the same shift, since a transfer is
  // one real-world event happening within a single shift on both sides.
  await mirrorTransferToOffline(
    productId,
    entryDate,
    shift,
    { stockOutOffToOl: merged.stockInOffToOl, stockInOlToOff: merged.stockOutOlToOff },
    userId
  );

  return saved;
}

async function mirrorTransferToOffline(
  productId: number,
  entryDate: Date,
  shift: Shift,
  mirrored: { stockOutOffToOl: number; stockInOlToOff: number },
  userId?: number
) {
  const existing = await dailyOfflineStockRepository.findByProductAndDate(productId, entryDate, shift);

  // saveOnlineEntry calls this mirror unconditionally after every save, even
  // when only an unrelated field (e.g. Fulfillment Out) changed and the
  // transfer figures are exactly what the offline side already has. Without
  // this guard that's a no-op write plus a change-log entry with nothing to
  // show for it, on every single Online save.
  if (existing && toNum(existing.stockInOlToOff) === mirrored.stockInOlToOff && toNum(existing.stockOutOffToOl) === mirrored.stockOutOffToOl) {
    return;
  }
  if (!existing && mirrored.stockInOlToOff === 0 && mirrored.stockOutOffToOl === 0) {
    return; // nothing has actually transferred yet - don't create a blank row just to mirror zeros
  }

  const openingStock = existing ? toNum(existing.openingStock) : await dailyOfflineStockRepository.getOpeningStock(productId, entryDate, shift);

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
    shift,
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
/// shift's Online Fulfillment (Out).
export async function addFulfillmentFromReceipt(productId: number, entryDate: Date, shift: Shift, additionalQty: number, userId?: number) {
  const existing = await dailyOnlineStockRepository.findByProductAndDate(productId, entryDate, shift);
  const currentFulfillment = toNum(existing?.fulfillmentOut);
  await saveOnlineEntry(productId, entryDate, shift, { fulfillmentOut: currentFulfillment + additionalQty }, userId);
}
