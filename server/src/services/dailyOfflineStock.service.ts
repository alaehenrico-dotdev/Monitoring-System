import { Shift } from "@prisma/client";
import { prisma, type Db } from "../lib/prisma";
import { dailyOfflineStockRepository } from "../repositories/dailyOfflineStockRepository";
import { dailyOnlineStockRepository } from "../repositories/dailyOnlineStockRepository";
import { productRepository } from "../repositories/productRepository";
import { recordChange } from "./changeLog.service";
import { broadcastRealtimeEvent } from "../lib/realtime";
import { HttpError } from "../utils/HttpError";
import {
  calculateOfflineRemaining,
  calculateOfflineStock,
  calculateOnlineRemaining,
  calculateOnlineStock,
  isNegativeStock,
  toNum,
} from "../utils/stockMath";

const TABLE = "daily_offline_stock";
const ONLINE_TABLE = "daily_online_stock";

export interface OfflineEntryInput {
  stockInOlToOff?: number;
  stockOutOffToOl?: number;
  productionIn?: number;
  /// Flat total (CSV import). Delivery (Out) is really the sum of the five
  /// slots below; a flat figure with no slots given lands in slot 1.
  deliveryOut?: number;
  delivery1?: number;
  delivery2?: number;
  delivery3?: number;
  delivery4?: number;
  delivery5?: number;
  backloads?: number;
  upsellOut?: number;
  /// See OnlineEntryInput's own doc comment (dailyOnlineStock.service.ts) -
  /// same reasoning, same CSV-import-only exception to auto-carry-forward.
  openingStock?: number;
}

const DELIVERY_SLOTS = ["delivery1", "delivery2", "delivery3", "delivery4", "delivery5"] as const;

/// Delivery (Out) is always the sum of the five slots - typed in the grid's
/// expandable Delivery columns - never entered on its own.
function resolveDelivery(existing: Record<string, unknown> | null, input: OfflineEntryInput) {
  const slots = {} as Record<(typeof DELIVERY_SLOTS)[number], number>;
  if (DELIVERY_SLOTS.some((k) => input[k] !== undefined)) {
    for (const k of DELIVERY_SLOTS) slots[k] = input[k] ?? toNum(existing?.[k] as never);
  } else if (input.deliveryOut !== undefined) {
    for (const k of DELIVERY_SLOTS) slots[k] = k === "delivery1" ? input.deliveryOut : 0;
  } else {
    for (const k of DELIVERY_SLOTS) slots[k] = toNum(existing?.[k] as never);
    // A row saved before the slots existed has only its flat total.
    if (DELIVERY_SLOTS.every((k) => slots[k] === 0) && existing) slots.delivery1 = toNum(existing.deliveryOut as never);
  }
  const deliveryOut = DELIVERY_SLOTS.reduce((sum, k) => sum + slots[k], 0);
  return { ...slots, deliveryOut };
}

/// Section 4.6 - same shift-aware carry-forward principle as the Online table.
export function computeOpeningStock(productId: number, entryDate: Date, shift: Shift, db: Db = prisma): Promise<number> {
  return dailyOfflineStockRepository.getOpeningStock(productId, entryDate, shift, db);
}

function calculate(opening: number, input: Required<Omit<OfflineEntryInput, "openingStock">>) {
  const offlineStock = calculateOfflineStock(opening, input.stockInOlToOff, input.stockOutOffToOl);
  const remainingStock = calculateOfflineRemaining(offlineStock, input.productionIn, input.deliveryOut, input.backloads, input.upsellOut);
  return { offlineStock, remainingStock };
}

/// Same N+1 avoidance as getOnlineGrid - opening stocks for every row are
/// fetched in one batched call instead of one query per product.
export async function getOfflineGrid(entryDate: Date, shift: Shift) {
  const products = await productRepository.findActive();
  const rows = await dailyOfflineStockRepository.findAllForDate(entryDate, shift);
  const rowByProduct = new Map(rows.map((r) => [r.productId, r]));

  const missingProductIds = products.filter((p) => !rowByProduct.has(p.id)).map((p) => p.id);
  const openingStockByProduct = await dailyOfflineStockRepository.getOpeningStocksForProducts(missingProductIds, entryDate, shift);

  return products.map((product) => {
    const existing = rowByProduct.get(product.id);
    if (existing) return { product, entry: { ...existing, ...resolveDelivery(existing, {}) }, isSaved: true };

    const openingStock = openingStockByProduct.get(product.id) ?? 0;
    const zero: Required<Omit<OfflineEntryInput, "openingStock">> = {
      stockInOlToOff: 0,
      stockOutOffToOl: 0,
      productionIn: 0,
      deliveryOut: 0,
      delivery1: 0,
      delivery2: 0,
      delivery3: 0,
      delivery4: 0,
      delivery5: 0,
      backloads: 0,
      upsellOut: 0,
    };
    const { offlineStock, remainingStock } = calculate(openingStock, zero);
    return {
      product,
      entry: { productId: product.id, entryDate, shift, openingStock, ...zero, offlineStock, remainingStock },
      isSaved: false,
    };
  });
}

/// Encoder-facing upsert for one product/date/shift cell row (Section 4.3).
export async function saveOfflineEntry(
  productId: number,
  entryDate: Date,
  shift: Shift,
  input: OfflineEntryInput,
  userId?: number,
  db: Db = prisma,
) {
  const product = await productRepository.findActiveById(productId, db);
  if (!product) throw HttpError.notFound("Active product not found");
  const existing = await dailyOfflineStockRepository.findByProductAndDate(productId, entryDate, shift, db);

  const openingStock =
    input.openingStock ?? (existing ? toNum(existing.openingStock) : await computeOpeningStock(productId, entryDate, shift, db));
  const merged: Required<Omit<OfflineEntryInput, "openingStock">> = {
    stockInOlToOff: input.stockInOlToOff ?? toNum(existing?.stockInOlToOff),
    stockOutOffToOl: input.stockOutOffToOl ?? toNum(existing?.stockOutOffToOl),
    productionIn: input.productionIn ?? toNum(existing?.productionIn),
    ...resolveDelivery(existing, input),
    backloads: input.backloads ?? toNum(existing?.backloads),
    upsellOut: input.upsellOut ?? toNum(existing?.upsellOut),
  };
  const { offlineStock, remainingStock } = calculate(openingStock, merged);

  // Negative-stock guard - see the matching comment in
  // dailyOnlineStock.service.ts's saveOnlineEntry.
  if (isNegativeStock(remainingStock)) {
    throw HttpError.badRequest(
      `This would take ${product.name}'s Offline stock below zero (would end at ${remainingStock}). Reduce Delivery (Out)/Upsell (Out) or the transfer out to Online, or add Production (In)/Backloads first.`
    );
  }

  const data = { productId, entryDate, shift, openingStock, ...merged, offlineStock, remainingStock, encodedById: userId };
  const saved = await dailyOfflineStockRepository.upsert(existing?.id, data, db);

  await recordChange(
    {
      tableName: TABLE,
      recordId: saved.id,
      action: existing ? "UPDATE" : "CREATE",
      changedById: userId,
      oldValue: existing,
      newValue: saved,
    },
    db,
  );

  // Section 4.3 - mirror this transfer back onto the Online table via its
  // repository directly, keeping the two stock services independent of
  // each other (see dailyOnlineStock.service.ts for the reverse direction).
  // Mirrored into the same shift - see that file's own comment for why.
  await mirrorTransferToOnline(
    productId,
    entryDate,
    shift,
    { stockInOffToOl: merged.stockOutOffToOl, stockOutOlToOff: merged.stockInOlToOff },
    userId,
    db,
  );

  broadcastRealtimeEvent();
  return saved;
}

async function mirrorTransferToOnline(
  productId: number,
  entryDate: Date,
  shift: Shift,
  mirrored: { stockInOffToOl: number; stockOutOlToOff: number },
  userId?: number,
  db: Db = prisma,
) {
  const existing = await dailyOnlineStockRepository.findByProductAndDate(productId, entryDate, shift, db);

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

  const openingStock = existing ? toNum(existing.openingStock) : await dailyOnlineStockRepository.getOpeningStock(productId, entryDate, shift, db);

  const merged = {
    stockInOffToOl: mirrored.stockInOffToOl,
    stockOutOlToOff: mirrored.stockOutOlToOff,
    productionIn: toNum(existing?.productionIn),
    fulfillmentOut: toNum(existing?.fulfillmentOut),
    rts: toNum(existing?.rts),
  };
  const onlineStock = calculateOnlineStock(openingStock, merged.stockInOffToOl, merged.stockOutOlToOff);
  const remainingStock = calculateOnlineRemaining(onlineStock, merged.productionIn, merged.fulfillmentOut, merged.rts);

  // Same guard as the reverse direction in dailyOnlineStock.service.ts's
  // mirrorTransferToOffline - pulling stock INTO Offline FROM Online
  // mirrors as Online's stockOutOlToOff, a real Stock Out for Online that
  // can't exceed what Online actually has, even though the transfer was
  // entered on the Offline grid.
  if (isNegativeStock(remainingStock)) {
    const product = await productRepository.findActiveById(productId, db);
    throw HttpError.badRequest(
      `This transfer would take ${product?.name ?? `product #${productId}`}'s Online stock below zero (would end at ${remainingStock}).`
    );
  }

  const data = {
    productId,
    entryDate,
    shift,
    openingStock,
    ...merged,
    onlineStock,
    remainingStock,
    encodedById: existing?.encodedById ?? userId,
  };
  const saved = await dailyOnlineStockRepository.upsert(existing?.id, data, db);

  await recordChange(
    {
      tableName: ONLINE_TABLE,
      recordId: saved.id,
      action: existing ? "UPDATE" : "CREATE",
      changedById: userId,
      oldValue: existing,
      newValue: saved,
    },
    db,
  );
}
