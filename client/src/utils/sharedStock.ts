/**
 * Client-side mirror of server/src/utils/sharedStock.ts, kept in sync by hand.
 *
 * Palm Oil Gallon and Palm Oil Liter share ONE stock (1 : 1) across Online AND Offline: four rows, one
 * pool. All four show the same Opening, Stock and Remaining Stock; each row's own entries still move it.
 * The server saves them that way. A page only has its own channel's sheet, so the figure it gets for a
 * saved row is already the whole pool's; this adds what is typed on the page but not saved yet (the live
 * preview of staged edits, and the Save review's "will end below zero" warning, which reads the same
 * rows), so the pool's preview moves as the encoder types. If the two copies drift apart the preview is
 * less accurate; what is saved is always the server's own calculation.
 */
export const SHARED_STOCK_SKUS: readonly string[] = ["AFP069", "AFP070"];

/// Rows to add up when totalling Remaining Stock: the second row of the shared stock shows the same figure
/// as the first, so counting both would count the pool twice. (The server flags it: totalStocks.service.ts.)
export const withoutSharedDuplicates = <T extends { sharedStockDuplicate?: boolean }>(rows: T[]): T[] => rows.filter((r) => !r.sharedStockDuplicate);

const isSharedStockSku = (sku: string | null | undefined) => !!sku && SHARED_STOCK_SKUS.includes(sku);

type Figures = Record<string, unknown>;
type GridRow = { product: { id?: number; sku?: string | null }; entry: Figures; isSaved?: boolean };

const num = (v: unknown) => Number(v ?? 0);
const round2 = (value: number) => Math.round((value + Number.EPSILON) * 100) / 100;

/// What a row adds to the pool: production and returns in, fulfillment / delivery / upsell out. Transfers
/// between Online and Offline are inside the pool and move nothing.
function net(entry: Figures, location: "ONLINE" | "OFFLINE"): number {
  return location === "ONLINE"
    ? num(entry.productionIn) - num(entry.fulfillmentOut) + num(entry.rts)
    : num(entry.productionIn) - num(entry.deliveryOut) - num(entry.upsellOut) + num(entry.backloads);
}

/// `display` is the grid as shown (saved rows with the staged edits laid over them), `saved` the same grid
/// without the staged edits. The pool's figure is the saved one plus what the staged edits change.
export function applySharedStockToGrid<T extends GridRow>(display: T[] | null | undefined, saved: GridRow[] | null | undefined, location: "ONLINE" | "OFFLINE"): T[] | null | undefined {
  if (!display || !saved) return display;
  const pair = display.filter((r) => isSharedStockSku(r.product.sku));
  if (pair.length !== 2 || pair[0].product.sku === pair[1].product.sku) return display;
  const savedPair = pair.map((r) => saved.find((s) => s.product.id !== undefined && s.product.id === r.product.id));
  if (savedPair.some((s) => !s)) return display;

  // The pool's saved figure: a saved row holds it; two previews both just carry the opening.
  const source = savedPair.find((s) => s?.isSaved) ?? savedPair[0]!;
  const opening = num(source.entry.openingStock);
  const base = num(source.entry.remainingStock);
  const delta = pair.reduce((sum, r, i) => sum + net(r.entry, location) - net(savedPair[i]!.entry, location), 0);
  const remaining = round2(base + delta);
  const stockKey = location === "ONLINE" ? "onlineStock" : "offlineStock";
  return display.map((r) => (pair.includes(r) ? { ...r, entry: { ...r.entry, openingStock: opening, [stockKey]: opening, remainingStock: remaining } } : r));
}

/// Columns that show the POOL's figure on both rows of the shared stock (the others hold what was typed on
/// that row alone, and add up as usual).
const POOLED_KEYS = new Set(["openingStock", "onlineStock", "offlineStock", "remainingStock"]);

/// The rows to add up for a column's total over `list` (a category, the whole sheet, a selection). When the
/// list holds both rows of the shared stock and the column shows the pool, the pool is one figure, not two:
/// the second row (the higher id) is left out. A category that holds only one of them, or any other column,
/// is untouched.
export function rowsForColumnTotal<T extends { product: { id?: number; sku?: string | null } }>(list: T[], key: string): T[] {
  if (!POOLED_KEYS.has(key)) return list;
  const pair = list.filter((r) => isSharedStockSku(r.product.sku));
  if (pair.length !== 2 || pair[0].product.sku === pair[1].product.sku) return list;
  const drop = (pair[0].product.id ?? 0) > (pair[1].product.id ?? 0) ? pair[0] : pair[1];
  return list.filter((r) => r !== drop);
}
