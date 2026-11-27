/**
 * Products that share ONE stock.
 *
 * Palm Oil Gallon and Palm Oil Liter are two lines on the grids (separate names, separate entries)
 * but one physical stock: a unit is a unit whichever line, and whichever channel (Online or Offline),
 * it was entered on (1 : 1, no gallon-to-liter conversion). So there is ONE pool behind four rows:
 * Gallon Online, Gallon Offline, Liter Online, Liter Offline.
 *
 * What "shared" means, per period (date + shift):
 *  - all four rows have the SAME Opening Stock, and show the SAME Stock and Remaining Stock;
 *  - each row's In / Out / Production / Fulfillment / Delivery... still holds only what was entered
 *    on that line, and ALL of them move the one pool;
 *  - a transfer between Online and Offline is inside the pool, so it moves nothing: Remaining is the
 *    opening plus production and returns, less fulfillment, delivery and upsell, across all four rows.
 *    (Counting the transfers too would give the same figure while both sides are mirrored, and a wrong
 *    one the moment they are not, so they are left out.)
 * Because all four rows close on the same figure, the ordinary per-product carry-forward
 * (getOpeningStock) keeps the pool in step day to day with no further special casing, and an audit count
 * is applied to all four rows alike (see planSharedCounts).
 *
 * Pure functions only (no framework or database imports), like stockMath.ts. The repositories keep the
 * stored rows in this shape (repositories/sharedStockPool.ts); Total Stocks and the reconcile check read it.
 */
import { calculateOfflineRemaining, calculateOnlineRemaining, toNum } from "./stockMath";

/// The SKUs that share one stock. Exactly two products: a pair is only formed when both SKUs exist,
/// so a missing or renamed SKU simply leaves each product on its own stock.
export const SHARED_STOCK_SKUS: readonly string[] = ["AFP069", "AFP070"];

export function isSharedStockSku(sku: string | null | undefined): boolean {
  return !!sku && SHARED_STOCK_SKUS.includes(sku);
}

type Figures = Record<string, unknown>;

const sum = (rows: Figures[], key: string) => rows.reduce((total, r) => total + toNum(r[key]), 0);

/// The pool's figures for one period: `stock` (what every row shows as its Online / Offline Stocks
/// subtotal) is the opening, `remaining` the opening after every row's movements. `online` and
/// `offline` are whichever of the four rows exist.
export function poolShared(opening: number, online: Figures[], offline: Figures[]) {
  const afterOnline = calculateOnlineRemaining(opening, sum(online, "productionIn"), sum(online, "fulfillmentOut"), sum(online, "rts"));
  const remaining = calculateOfflineRemaining(
    afterOnline,
    sum(offline, "productionIn"),
    sum(offline, "deliveryOut"),
    sum(offline, "backloads"),
    sum(offline, "upsellOut"),
  );
  return { stock: toNum(opening), remaining };
}

/// A pending audit count, as far as pooling cares.
export interface PendingCountLike {
  productId: number;
  location: string;
  manualCount: unknown;
  remarks?: string | null;
  updatedAt: Date;
}

/// One count for the whole pool. The four rows are counted ONCE: whichever of them was counted (on any
/// of the pool's Online / Offline sheets) gives the figure, the most recently saved count winning when
/// more than one was typed, and every one of the four rows is then given that same count. A count the
/// system filled in as "not counted" never wins over one somebody typed. Returns null when none of the
/// four was counted (the ordinary rule - uncounted is 0 - then applies to each).
export function planSharedCounts(pending: PendingCountLike[], sharedProductIds: number[], notCountedNote: string): number | null {
  const typed = pending.filter(
    (c) => sharedProductIds.includes(c.productId) && (c.location === "ONLINE" || c.location === "OFFLINE") && c.remarks !== notCountedNote,
  );
  if (typed.length === 0) return null;
  const latest = typed.reduce((best, c) => (c.updatedAt.getTime() >= best.updatedAt.getTime() ? c : best));
  return toNum(latest.manualCount);
}
