/// How far along an entry sheet is: which products have been entered and which are
/// still blank, in the order the grid shows them - so "next blank" walks the sheet
/// top to bottom the way the encoder does.
///
/// A product counts as entered once it is saved or has a staged edit. A saved
/// zero counts (the encoder looked and it was nothing); an untouched row does not,
/// even when carry-forward has filled its opening stock.

interface RowLike {
  product: { id: number; category: string };
  isSaved?: boolean;
}

export interface EntryProgress {
  total: number;
  done: number;
  /// Product ids in grid order (categories in order of first appearance).
  order: number[];
  /// Ids still blank, in grid order.
  blank: number[];
}

export function entryProgress(rows: RowLike[] | null | undefined, pending: Record<number, Record<string, unknown>>): EntryProgress {
  const list = rows ?? [];
  // The grid groups by category, listing categories as they first appear.
  const categories: string[] = [];
  for (const r of list) if (!categories.includes(r.product.category)) categories.push(r.product.category);
  const ordered = categories.flatMap((c) => list.filter((r) => r.product.category === c));

  const order = ordered.map((r) => r.product.id);
  const blank = ordered
    .filter((r) => !r.isSaved && Object.keys(pending[r.product.id] ?? {}).length === 0)
    .map((r) => r.product.id);
  return { total: order.length, done: order.length - blank.length, order, blank };
}

/// The next blank product after `fromId` in grid order, wrapping to the top; the
/// first blank when `fromId` is null or not on the sheet; null when none is left.
export function nextBlank(progress: EntryProgress, fromId: number | null): number | null {
  if (progress.blank.length === 0) return null;
  const blank = new Set(progress.blank);
  const start = fromId === null ? -1 : progress.order.indexOf(fromId);
  const n = progress.order.length;
  for (let step = 1; step <= n; step++) {
    const id = progress.order[(start + step + n) % n];
    if (blank.has(id)) return id;
  }
  return null;
}
