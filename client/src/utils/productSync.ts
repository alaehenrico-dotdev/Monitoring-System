import { categoryKey, FUZZY_MATCH_THRESHOLD, fuzzyScore, strictNameKey } from "./importMatch";
import type { SheetProduct } from "./combinedSheet";

export interface ExistingProduct {
  id: number;
  name: string;
  category: string;
  sortOrder: number;
  sku?: string | null;
}

export interface SyncItem {
  category: string;
  name: string;
  /// Set when the row is an existing product (possibly in another category).
  productId?: number;
  /// With productId: the sheet's spelling replaces the product's name.
  rename?: boolean;
}

export interface NewProduct extends SyncItem {
  /// Stable id of the sheet row, for linking it to an existing product.
  key: string;
  /// The most similar existing products no sheet row claims (best first) -
  /// offered as "same product, different spelling", never applied on their own.
  suggestions: ExistingProduct[];
}

export interface ProductSyncPlan {
  /// What is sent to the server: the whole sheet, in the sheet's order.
  items: SyncItem[];
  toCreate: NewProduct[];
  toMove: { name: string; from: string; to: string }[];
  /// Existing products renamed to the sheet's spelling because the admin linked them.
  toRename: { key: string; from: string; to: string }[];
  /// Existing products whose position changes.
  reordered: number;
  /// Nothing to add, move, rename or reorder.
  inSync: boolean;
}

const clean = (s: string) => s.trim().replace(/\s+/g, " ");

/// Identifies one sheet row (category + name) for `links`.
export function sheetRowKey(category: string, name: string): string {
  return `${categoryKey(category)}|${strictNameKey(name)}`;
}

/**
 * What it would take to make the product list match the sheet: which products
 * to add, which sit under a different category than the sheet puts them in, and
 * whether the order differs. Pure - the admin sees this before anything changes.
 *
 * Matching is the same strict comparison the import uses (strictNameKey for
 * names; the looser categoryKey for category headings). A name that is not
 * found in the sheet's category but exists exactly once elsewhere, and is not
 * claimed by another row of the sheet, is the same product under another
 * heading - it is moved, not duplicated. Anything else becomes a new product,
 * unless the admin linked the row to an existing product (`links`: row key ->
 * product id), which is then renamed to the sheet's spelling.
 */
export function planProductSync(
  sheet: SheetProduct[],
  existing: ExistingProduct[],
  links: Record<string, number> = {},
): ProductSyncPlan {
  const current = [...existing].sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name));
  // A sheet category resolves to the system's own spelling of it when there is one.
  const categorySpelling = new Map<string, string>();
  for (const p of current) if (!categorySpelling.has(categoryKey(p.category))) categorySpelling.set(categoryKey(p.category), p.category);
  const resolveCategory = (c: string) => categorySpelling.get(categoryKey(c)) ?? clean(c);

  // The sheet, de-duplicated (a repeated row is the same row).
  const rows: SyncItem[] = [];
  const seen = new Set<string>();
  for (const s of sheet) {
    const item = { category: resolveCategory(s.category), name: clean(s.name) };
    const k = sheetRowKey(item.category, item.name);
    if (seen.has(k)) continue;
    seen.add(k);
    rows.push(item);
  }

  const claimed = new Set<number>();
  const matched = new Map<SyncItem, ExistingProduct>();
  const linked = new Set<SyncItem>();
  // 1. Explicit links by the admin win over everything.
  for (const row of rows) {
    const id = links[sheetRowKey(row.category, row.name)];
    const hit = id === undefined ? undefined : current.find((p) => p.id === id && !claimed.has(p.id));
    if (hit) {
      claimed.add(hit.id);
      matched.set(row, hit);
      linked.add(row);
    }
  }
  // 2. Strict name + category.
  for (const row of rows) {
    if (matched.has(row)) continue;
    const hit = current.find(
      (p) =>
        !claimed.has(p.id) &&
        categoryKey(p.category) === categoryKey(row.category) &&
        strictNameKey(p.name) === strictNameKey(row.name),
    );
    if (hit) {
      claimed.add(hit.id);
      matched.set(row, hit);
    }
  }
  // 3. Same strict name under another category, when unambiguous.
  for (const row of rows) {
    if (matched.has(row)) continue;
    const elsewhere = current.filter((p) => !claimed.has(p.id) && strictNameKey(p.name) === strictNameKey(row.name));
    if (elsewhere.length !== 1) continue;
    claimed.add(elsewhere[0].id);
    matched.set(row, elsewhere[0]);
  }

  const toMove: ProductSyncPlan["toMove"] = [];
  const toRename: ProductSyncPlan["toRename"] = [];
  const items: SyncItem[] = [];
  const toCreate: NewProduct[] = [];
  const unclaimed = () => current.filter((p) => !claimed.has(p.id));
  for (const row of rows) {
    const hit = matched.get(row);
    if (!hit) {
      // Same category is the stronger hint; a different one needs a closer name.
      const suggestions = unclaimed()
        .map((p) => ({ p, score: fuzzyScore(row.name, p.name) + (categoryKey(p.category) === categoryKey(row.category) ? 0.05 : 0) }))
        .filter((c) => c.score >= FUZZY_MATCH_THRESHOLD)
        .sort((a, b) => b.score - a.score)
        .slice(0, 3)
        .map((c) => c.p);
      const item: NewProduct = { ...row, key: sheetRowKey(row.category, row.name), suggestions };
      toCreate.push(item);
      items.push({ category: row.category, name: row.name });
      continue;
    }
    const item: SyncItem = { ...row, productId: hit.id };
    if (linked.has(row) && hit.name !== row.name) {
      item.rename = true;
      toRename.push({ key: sheetRowKey(row.category, row.name), from: hit.name, to: row.name });
    }
    if (categoryKey(hit.category) !== categoryKey(row.category) && hit.category !== row.category) {
      toMove.push({ name: hit.name, from: hit.category, to: row.category });
    }
    items.push(item);
  }

  // New order of the whole list: the sheet's rows, then everything it does not mention.
  const finalIds = [...items.map((i) => i.productId ?? null), ...unclaimed().map((p) => p.id)];
  let reordered = 0;
  finalIds.forEach((id, i) => {
    const p = id === null ? undefined : current.find((x) => x.id === id);
    if (p && p.sortOrder !== i + 1) reordered++;
  });

  return {
    items,
    toCreate,
    toMove,
    toRename,
    reordered,
    inSync: toCreate.length === 0 && toMove.length === 0 && toRename.length === 0 && reordered === 0,
  };
}
