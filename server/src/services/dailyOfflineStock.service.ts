import { Shift } from "@prisma/client";
import { dailyOfflineStockRepository } from "../repositories/dailyOfflineStockRepository";
import { dailyOnlineStockRepository } from "../repositories/dailyOnlineStockRepository";
import { deliveryDestinationRepository } from "../repositories/deliveryDestinationRepository";
import { offlineEntryDeliveryRepository } from "../repositories/offlineEntryDeliveryRepository";
import { productRepository } from "../repositories/productRepository";
import { recordChange } from "./changeLog.service";
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
  /// Flat total, kept for CSV imports that only carry one Delivery (Out)
  /// number - ignored whenever deliveryByDestination is also given (see
  /// resolveDeliveryOut).
  deliveryOut?: number;
  /// Partial update: only the destination(s) actually being changed on this
  /// save, not the full breakdown - see resolveDeliveryOut for how this
  /// merges with whatever destinations were already on file.
  deliveryByDestination?: Record<string, number>;
  backloads?: number;
  upsellOut?: number;
  /// See OnlineEntryInput's own doc comment (dailyOnlineStock.service.ts) -
  /// same reasoning, same CSV-import-only exception to auto-carry-forward.
  openingStock?: number;
}

interface DestinationChange {
  destinationId: number;
  destinationName: string;
  oldQuantity: number;
  newQuantity: number;
}

/// Section 4.6 - same shift-aware carry-forward principle as the Online table.
export function computeOpeningStock(productId: number, entryDate: Date, shift: Shift): Promise<number> {
  return dailyOfflineStockRepository.getOpeningStock(productId, entryDate, shift);
}

function calculate(opening: number, input: Required<Omit<OfflineEntryInput, "openingStock" | "deliveryByDestination">>) {
  const offlineStock = calculateOfflineStock(opening, input.stockInOlToOff, input.stockOutOffToOl);
  const remainingStock = calculateOfflineRemaining(offlineStock, input.productionIn, input.deliveryOut, input.backloads, input.upsellOut);
  return { offlineStock, remainingStock };
}

function toDeliveryMap(rows?: { destinationId: number; quantity: number }[]): Record<number, number> {
  const map: Record<number, number> = {};
  for (const row of rows ?? []) map[row.destinationId] = row.quantity;
  return map;
}

function sumDeliveryMap(map: Record<number, number>): number {
  return Object.values(map).reduce((sum, quantity) => sum + quantity, 0);
}

/// Same N+1 avoidance as getOnlineGrid - opening stocks (and, here, the
/// per-destination delivery breakdown) for every row are fetched in one
/// batched call instead of one query per product.
export async function getOfflineGrid(entryDate: Date, shift: Shift) {
  const products = await productRepository.findActive();
  const rows = await dailyOfflineStockRepository.findAllForDate(entryDate, shift);
  const rowByProduct = new Map(rows.map((r) => [r.productId, r]));

  const missingProductIds = products.filter((p) => !rowByProduct.has(p.id)).map((p) => p.id);
  const openingStockByProduct = await dailyOfflineStockRepository.getOpeningStocksForProducts(missingProductIds, entryDate, shift);
  const deliveriesByEntryId = await offlineEntryDeliveryRepository.findByEntryIds(rows.map((r) => r.id));

  return products.map((product) => {
    const existing = rowByProduct.get(product.id);
    if (existing) {
      // deliveryOut is always recomputed from the breakdown rows here, not
      // read off the column - see resolveDeliveryOut/saveOfflineEntry for
      // why the column can't be trusted as the source of truth post-migration.
      const deliveryByDestination = toDeliveryMap(deliveriesByEntryId.get(existing.id));
      const deliveryOut = sumDeliveryMap(deliveryByDestination);
      return { product, entry: { ...existing, deliveryOut, deliveryByDestination }, isSaved: true };
    }

    const openingStock = openingStockByProduct.get(product.id) ?? 0;
    const zero: Required<Omit<OfflineEntryInput, "openingStock" | "deliveryByDestination">> = {
      stockInOlToOff: 0,
      stockOutOffToOl: 0,
      productionIn: 0,
      deliveryOut: 0,
      backloads: 0,
      upsellOut: 0,
    };
    const { offlineStock, remainingStock } = calculate(openingStock, zero);
    return {
      product,
      entry: { productId: product.id, entryDate, shift, openingStock, ...zero, offlineStock, remainingStock, deliveryByDestination: {} },
      isSaved: false,
    };
  });
}

/// Resolves the deliveryOut figure to persist for this save, plus the
/// per-destination changes to fold into the Change Log:
/// - deliveryByDestination given: this entry's Delivery (Out) is managed as
///   a breakdown from here on. Only the given destination(s) change - every
///   other destination already on file is carried forward untouched - and
///   the new deliveryOut is the sum across ALL destinations, not just the
///   ones in this request.
/// - otherwise: the flat `deliveryOut` (or the existing column value) is
///   used as-is, e.g. a CSV import that only ever carries one flat total
///   and was never broken down by destination.
async function resolveDeliveryOut(
  existing: { id: number; deliveryOut: unknown } | null,
  input: OfflineEntryInput
): Promise<{ deliveryOut: number; destinationChanges: DestinationChange[] }> {
  if (!input.deliveryByDestination || Object.keys(input.deliveryByDestination).length === 0) {
    return { deliveryOut: input.deliveryOut ?? toNum(existing?.deliveryOut), destinationChanges: [] };
  }

  const destinationIds = Object.keys(input.deliveryByDestination).map(Number);
  const destinations = await deliveryDestinationRepository.findByIds(destinationIds);
  const destinationById = new Map(destinations.map((d) => [d.id, d]));
  const missing = destinationIds.filter((id) => !destinationById.has(id));
  if (missing.length) throw HttpError.badRequest(`Unknown delivery destination id(s): ${missing.join(", ")}`);

  const existingDeliveries = existing ? await offlineEntryDeliveryRepository.findByEntryId(existing.id) : [];
  const quantityByDestination = new Map(existingDeliveries.map((d) => [d.destinationId, d.quantity]));

  const destinationChanges: DestinationChange[] = destinationIds.map((id) => {
    const newQuantity = input.deliveryByDestination![id];
    const change: DestinationChange = {
      destinationId: id,
      destinationName: destinationById.get(id)!.name,
      oldQuantity: quantityByDestination.get(id) ?? 0,
      newQuantity,
    };
    quantityByDestination.set(id, newQuantity); // fold the change into the running total below
    return change;
  });

  const deliveryOut = [...quantityByDestination.values()].reduce((sum, quantity) => sum + quantity, 0);
  return { deliveryOut, destinationChanges };
}

/// Encoder-facing upsert for one product/date/shift cell row (Section 4.3).
export async function saveOfflineEntry(productId: number, entryDate: Date, shift: Shift, input: OfflineEntryInput, userId?: number) {
  const product = await productRepository.findActiveById(productId);
  if (!product) throw HttpError.notFound("Active product not found");
  const existing = await dailyOfflineStockRepository.findByProductAndDate(productId, entryDate, shift);

  const openingStock =
    input.openingStock ?? (existing ? toNum(existing.openingStock) : await computeOpeningStock(productId, entryDate, shift));
  const { deliveryOut, destinationChanges } = await resolveDeliveryOut(existing, input);
  const merged: Required<Omit<OfflineEntryInput, "openingStock" | "deliveryByDestination">> = {
    stockInOlToOff: input.stockInOlToOff ?? toNum(existing?.stockInOlToOff),
    stockOutOffToOl: input.stockOutOffToOl ?? toNum(existing?.stockOutOffToOl),
    productionIn: input.productionIn ?? toNum(existing?.productionIn),
    deliveryOut,
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
  const saved = await dailyOfflineStockRepository.upsert(existing?.id, data);

  // Only now that the entry definitely has an id do we persist the
  // breakdown rows themselves - resolveDeliveryOut only computed the totals.
  if (input.deliveryByDestination) {
    for (const change of destinationChanges) {
      await offlineEntryDeliveryRepository.upsert(saved.id, change.destinationId, change.newQuantity);
    }
  }

  // Same whole-row before/after snapshot every other Offline save logs,
  // plus one synthetic "deliveryOut:<destination name>" field per changed
  // destination - the join rows aren't part of the row snapshot itself, so
  // without this a destination-only edit would show no field-level diff at
  // all in the Change Log UI (see diffFields in ChangeLogPage.tsx, which
  // diffs oldValue/newValue purely by object key).
  const oldValue: Record<string, unknown> | null = existing ? { ...existing } : destinationChanges.length ? {} : null;
  const newValue: Record<string, unknown> = { ...saved };
  for (const change of destinationChanges) {
    const key = `deliveryOut:${change.destinationName}`;
    if (oldValue) oldValue[key] = change.oldQuantity;
    newValue[key] = change.newQuantity;
  }

  await recordChange({
    tableName: TABLE,
    recordId: saved.id,
    action: existing ? "UPDATE" : "CREATE",
    changedById: userId,
    oldValue,
    newValue,
  });

  // Section 4.3 - mirror this transfer back onto the Online table via its
  // repository directly, keeping the two stock services independent of
  // each other (see dailyOnlineStock.service.ts for the reverse direction).
  // Mirrored into the same shift - see that file's own comment for why.
  await mirrorTransferToOnline(
    productId,
    entryDate,
    shift,
    { stockInOffToOl: merged.stockOutOffToOl, stockOutOlToOff: merged.stockInOlToOff },
    userId
  );

  return saved;
}

/// Section 4.7 - posting a Receipt's item quantities onto Delivery (Out),
/// mirroring addFulfillmentFromReceipt (dailyOnlineStock.service.ts) for the
/// Offline pool. Always a flat increment onto the deliveryOut column - never
/// split across destinations, regardless of whatever OfflineEntryDelivery
/// breakdown rows the entry already has (see resolveDeliveryOut: a plain
/// `deliveryOut` in the input takes the flat, no-breakdown path).
export async function addDeliveryFromReceipt(productId: number, entryDate: Date, shift: Shift, additionalQty: number, userId?: number) {
  const existing = await dailyOfflineStockRepository.findByProductAndDate(productId, entryDate, shift);
  const currentDeliveryOut = toNum(existing?.deliveryOut);
  await saveOfflineEntry(productId, entryDate, shift, { deliveryOut: currentDeliveryOut + additionalQty }, userId);
}

async function mirrorTransferToOnline(
  productId: number,
  entryDate: Date,
  shift: Shift,
  mirrored: { stockInOffToOl: number; stockOutOlToOff: number },
  userId?: number
) {
  const existing = await dailyOnlineStockRepository.findByProductAndDate(productId, entryDate, shift);

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

  const openingStock = existing ? toNum(existing.openingStock) : await dailyOnlineStockRepository.getOpeningStock(productId, entryDate, shift);

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
    const product = await productRepository.findActiveById(productId);
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
