import type { Product } from "@prisma/client";
import type { Db } from "../lib/prisma";
import { HttpError } from "../utils/HttpError";
import { toDateOnlyString } from "../utils/date";
import { toNum } from "../utils/stockMath";
import { recordChange } from "./changeLog.service";

export interface MergeOutcome {
  from: Product;
  into: Product;
  moved: { online: number; offline: number; extras: number; counts: number };
  /// Rows of the merged-away product with nothing in them, dropped rather than
  /// treated as a clash with the other product's row for the same period.
  droppedBlank: number;
}

const MAX_LISTED = 8;

/// A saved daily row with no stock on it at all (every figure 0) - what a row
/// that was only ever created, never typed into, looks like.
function isBlank(row: Record<string, unknown>, keys: readonly string[]): boolean {
  return keys.every((k) => toNum(row[k]) === 0);
}
const ONLINE_FIGURES = ["openingStock", "stockInOffToOl", "stockOutOlToOff", "onlineStock", "productionIn", "fulfillmentOut", "rts", "remainingStock"] as const;
const OFFLINE_FIGURES = [
  "openingStock", "stockInOlToOff", "stockOutOffToOl", "offlineStock", "productionIn",
  "deliveryOut", "upsellOut", "backloads", "remainingStock",
] as const;

/**
 * Makes `from` and `into` one product: everything recorded against `from` -
 * Online and Offline entries, added-column amounts, manual counts - moves onto
 * `into`, which keeps its own name, SKU and id, and `from` is deleted. For when
 * a product was added under another spelling of a name the system already has
 * (a template row that matched nothing), and has been used since.
 *
 * Only a product WITHOUT a SKU can be merged away - the SKU is the product's
 * identity, so the one that has it is always the one that survives.
 *
 * Two rows for the same period (same date and shift, and location for counts)
 * cannot both be kept, and silently picking one would lose figures, so when the
 * products clash anywhere the merge stops with the list and changes nothing
 * (the caller runs this in a transaction). A `from` row with no stock in it does
 * not count as a clash - it is dropped.
 *
 * Opening stocks already stored on the moved rows are not recomputed: if the two
 * products' histories do not line up where they join, the Audit page's
 * "opening does not carry forward" flag shows it.
 */
export async function mergeProductInto(tx: Db, fromId: number, intoId: number, userId?: number): Promise<MergeOutcome> {
  if (fromId === intoId) throw HttpError.badRequest("A product cannot be merged into itself");
  const [from, into] = await Promise.all([tx.product.findUnique({ where: { id: fromId } }), tx.product.findUnique({ where: { id: intoId } })]);
  if (!from) throw HttpError.badRequest(`Unknown product id ${fromId}`);
  if (!into) throw HttpError.badRequest(`Unknown product id ${intoId}`);
  if (from.sku) {
    throw HttpError.badRequest(`${from.name} has the SKU ${from.sku}, so it cannot be merged away - only a product without a SKU can be`);
  }

  const clashes: string[] = [];
  const period = (d: Date, shift: string) => `${toDateOnlyString(d)} ${shift === "MORNING" ? "Morning" : "Night"}`;

  const [fromOnline, intoOnline, fromOffline, intoOffline] = await Promise.all([
    tx.dailyOnlineStock.findMany({ where: { productId: fromId } }),
    tx.dailyOnlineStock.findMany({ where: { productId: intoId }, select: { entryDate: true, shift: true } }),
    tx.dailyOfflineStock.findMany({ where: { productId: fromId } }),
    tx.dailyOfflineStock.findMany({ where: { productId: intoId }, select: { entryDate: true, shift: true } }),
  ]);
  const takenOnline = new Set(intoOnline.map((r) => period(r.entryDate, r.shift)));
  const takenOffline = new Set(intoOffline.map((r) => period(r.entryDate, r.shift)));
  const blankOnline: number[] = [];
  const blankOffline: number[] = [];
  for (const r of fromOnline) {
    if (!takenOnline.has(period(r.entryDate, r.shift))) continue;
    if (isBlank(r, ONLINE_FIGURES)) blankOnline.push(r.id);
    else clashes.push(`Online ${period(r.entryDate, r.shift)}`);
  }
  for (const r of fromOffline) {
    if (!takenOffline.has(period(r.entryDate, r.shift))) continue;
    if (isBlank(r, OFFLINE_FIGURES)) blankOffline.push(r.id);
    else clashes.push(`Offline ${period(r.entryDate, r.shift)}`);
  }

  const [fromCounts, intoCounts, fromExtras, intoExtras] = await Promise.all([
    tx.manualCount.findMany({ where: { productId: fromId }, select: { entryDate: true, shift: true, location: true } }),
    tx.manualCount.findMany({ where: { productId: intoId }, select: { entryDate: true, shift: true, location: true } }),
    tx.dailyStockExtra.findMany({ where: { productId: fromId }, select: { location: true, entryDate: true, shift: true, columnKey: true, slotIndex: true } }),
    tx.dailyStockExtra.findMany({ where: { productId: intoId }, select: { location: true, entryDate: true, shift: true, columnKey: true, slotIndex: true } }),
  ]);
  const countKey = (r: { entryDate: Date; shift: string; location: string }) => `${r.location} ${period(r.entryDate, r.shift)}`;
  const takenCounts = new Set(intoCounts.map(countKey));
  for (const r of fromCounts) if (takenCounts.has(countKey(r))) clashes.push(`Count (${countKey(r)})`);
  const extraKey = (r: { location: string; entryDate: Date; shift: string; columnKey: string; slotIndex: number }) =>
    `${r.location} ${period(r.entryDate, r.shift)} ${r.columnKey}#${r.slotIndex}`;
  const takenExtras = new Set(intoExtras.map(extraKey));
  for (const r of fromExtras) if (takenExtras.has(extraKey(r))) clashes.push(`Added column (${extraKey(r)})`);

  if (clashes.length > 0) {
    const listed = clashes.slice(0, MAX_LISTED).join("; ");
    const more = clashes.length > MAX_LISTED ? ` (and ${clashes.length - MAX_LISTED} more)` : "";
    throw HttpError.conflict(
      `${from.name} and ${into.name} both have entries for the same period, so they cannot be merged automatically: ${listed}${more}. Delete or move one side first.`,
    );
  }

  if (blankOnline.length) await tx.dailyOnlineStock.deleteMany({ where: { id: { in: blankOnline } } });
  if (blankOffline.length) await tx.dailyOfflineStock.deleteMany({ where: { id: { in: blankOffline } } });
  const [online, offline, counts, extras] = await Promise.all([
    tx.dailyOnlineStock.updateMany({ where: { productId: fromId }, data: { productId: intoId } }),
    tx.dailyOfflineStock.updateMany({ where: { productId: fromId }, data: { productId: intoId } }),
    tx.manualCount.updateMany({ where: { productId: fromId }, data: { productId: intoId } }),
    tx.dailyStockExtra.updateMany({ where: { productId: fromId }, data: { productId: intoId } }),
  ]);

  await tx.product.delete({ where: { id: fromId } });
  await recordChange({ tableName: "products", recordId: fromId, action: "DELETE", changedById: userId, oldValue: from, newValue: undefined }, tx);

  return {
    from,
    into,
    moved: { online: online.count, offline: offline.count, extras: extras.count, counts: counts.count },
    droppedBlank: blankOnline.length + blankOffline.length,
  };
}
