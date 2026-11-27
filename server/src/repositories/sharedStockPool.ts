import type { Shift } from "@prisma/client";
import { prisma, type Db } from "../lib/prisma";
import { poolShared, SHARED_STOCK_SKUS } from "../utils/sharedStock";
import { toNum } from "../utils/stockMath";

/// The ids of the products that share one stock, remembered briefly: this runs on every Online and
/// Offline row write, and a carry-forward walk writes many rows, but the two products' SKUs almost
/// never change. A SKU edit is picked up within the TTL.
const PARTNER_TTL_MS = 30_000;
let sharedIds: { at: number; ids: number[] } | null = null;

export function resetSharedStockCache() {
  sharedIds = null;
}

async function loadSharedIds(db: Db): Promise<number[]> {
  if (sharedIds && Date.now() - sharedIds.at < PARTNER_TTL_MS) return sharedIds.ids;
  const shared = await db.product.findMany({ where: { sku: { in: [...SHARED_STOCK_SKUS] } }, select: { id: true } });
  // Only a complete pair counts; otherwise each product keeps its own stock.
  const ids = shared.length === SHARED_STOCK_SKUS.length ? shared.map((p) => p.id) : [];
  sharedIds = { at: Date.now(), ids };
  return ids;
}

/// The ids of the products sharing one stock (both of them), or [] when there is no complete pair.
export function findSharedStockProductIds(db: Db = prisma): Promise<number[]> {
  return loadSharedIds(db);
}

/// The product that shares its stock with `productId` (utils/sharedStock.ts), or
/// null when this product has its own stock.
export async function findSharedStockPartnerId(productId: number, db: Db = prisma): Promise<number | null> {
  const ids = await loadSharedIds(db);
  return ids.includes(productId) ? (ids.find((id) => id !== productId) ?? null) : null;
}

const differs = (a: unknown, b: number) => toNum(a) !== b;

type RowKey = { entryDate: Date; shift: Shift };

/// Called by a stock repository right after it wrote `saved` (an Online or an Offline row): brings all
/// FOUR rows of the pool for that period - this product's and its partner's, Online and Offline - to the
/// shared shape: the saved row's opening, and the one Stock / Remaining Stock over every row's movements.
/// A row that does not exist yet is created empty (no movements of its own), so the pool always has all
/// four rows for any period any of them has, and each one's ordinary carry-forward lands on the same
/// figure. Returns `saved` as it ended up.
export async function poolSharedRows<R extends RowKey & { id: number; productId: number; openingStock: unknown; remainingStock: unknown; encodedById: number | null }>(
  saved: R,
  location: "ONLINE" | "OFFLINE",
  partnerId: number,
  db: Db,
): Promise<R> {
  const { entryDate, shift } = saved;
  const productIds = [saved.productId, partnerId];
  const where = { productId: { in: productIds }, entryDate, shift };
  const [online, offline] = await Promise.all([db.dailyOnlineStock.findMany({ where }), db.dailyOfflineStock.findMany({ where })]);

  const opening = toNum(saved.openingStock);
  const { stock, remaining } = poolShared(opening, online, offline);
  const encodedById = saved.encodedById ?? undefined;
  let result = saved;

  for (const productId of productIds) {
    const on = online.find((r) => r.productId === productId);
    if (!on) {
      await db.dailyOnlineStock.create({ data: { productId, entryDate, shift, openingStock: opening, onlineStock: stock, remainingStock: remaining, encodedById } });
    } else if (differs(on.openingStock, opening) || differs(on.onlineStock, stock) || differs(on.remainingStock, remaining)) {
      const row = await db.dailyOnlineStock.update({ where: { id: on.id }, data: { openingStock: opening, onlineStock: stock, remainingStock: remaining } });
      if (location === "ONLINE" && on.id === saved.id) result = row as unknown as R;
    }

    const off = offline.find((r) => r.productId === productId);
    if (!off) {
      await db.dailyOfflineStock.create({ data: { productId, entryDate, shift, openingStock: opening, offlineStock: stock, remainingStock: remaining, encodedById } });
    } else if (differs(off.openingStock, opening) || differs(off.offlineStock, stock) || differs(off.remainingStock, remaining)) {
      const row = await db.dailyOfflineStock.update({ where: { id: off.id }, data: { openingStock: opening, offlineStock: stock, remainingStock: remaining } });
      if (location === "OFFLINE" && off.id === saved.id) result = row as unknown as R;
    }
  }
  return result;
}
