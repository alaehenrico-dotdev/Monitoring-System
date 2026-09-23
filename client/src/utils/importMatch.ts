/**
 * Pure column/header-matching logic for the grid CSV import (CsvTools.tsx).
 * Pulled out on its own so it can be unit-tested directly against the real
 * monthly report headers (see importMatch.test.ts) without having to render
 * the whole CsvTools component - "does every column in the actual file get
 * recognized" is a plain data question, not a UI one.
 */

export interface ImportableColumn {
  key: string;
  label: string;
  editable?: boolean;
  /// Extra header spellings this column should also be recognized under -
  /// the real-world monthly reports this re-imports from use their own
  /// shorthand/typo'd header names ("STOCKS IN", "FULLFILMENT (OUT)",
  /// "BACKLOAD") rather than this app's own export labels, and there's no
  /// reliable way to derive one spelling from the other automatically.
  aliases?: string[];
  /// Recognized on import even when editable is false (a computed/carried-
  /// forward column that a fresh file can still seed - see stockColumns.ts).
  importable?: boolean;
}

const PRODUCT_HEADER_NAMES = ["product", "products", "sku", "skus"];

/// Finds which row of a parsed CSV is the real header row. Normally row 0,
/// but a file that's been round-tripped through Excel (or had a title/blank
/// row pasted above it - exactly what the monthly report's own row 0/row 2
/// look like) can push the real header down. Scans for the first row
/// containing a recognized product-name column instead of assuming row 0.
/// Returns -1 if no such row exists.
export function findHeaderRowIndex(table: string[][]): number {
  return table.findIndex((row) => row.some((cell) => PRODUCT_HEADER_NAMES.includes(cell.trim().toLowerCase())));
}

/// Index of the product-name column within an already-located header row.
export function findProductColumnIndex(header: string[]): number {
  return header.findIndex((h) => PRODUCT_HEADER_NAMES.includes(h.trim().toLowerCase()));
}

/// For every column that's read on import (editable, or explicitly marked
/// importable), finds which cell of `header` it corresponds to by label or
/// any alias, case-insensitively. A column with no match in this file is
/// left out of the result entirely (nothing to read for it), not an error -
/// a file doesn't have to carry every column.
export function matchColumnIndexes(
  columns: ImportableColumn[],
  header: string[],
): { key: string; idx: number }[] {
  const normalizedHeader = header.map((h) => h.trim().toLowerCase());
  return columns
    .filter((c) => c.editable || c.importable)
    .map((col) => {
      const names = [col.label, ...(col.aliases ?? [])].map((n) => n.toLowerCase());
      const idx = normalizedHeader.findIndex((h) => names.includes(h));
      return { key: col.key, idx };
    })
    .filter((c) => c.idx !== -1);
}

/// Which of `columns` have no matching cell anywhere in `header` - used to
/// surface a clear "these columns weren't found in this file" warning
/// instead of the gap only showing up indirectly (as every row's value for
/// that column silently staying unchanged).
export function unmatchedColumns(columns: ImportableColumn[], header: string[]): ImportableColumn[] {
  const matchedKeys = new Set(matchColumnIndexes(columns, header).map((c) => c.key));
  return columns.filter((c) => (c.editable || c.importable) && !matchedKeys.has(c.key));
}

/// Loosens a product/category name for comparison during import: lowercased
/// with all punctuation and whitespace stripped, so "CLASS A -(LITER)" and
/// "Class A (Liter)" (or "SWEET A" and "Sweet A") are recognized as the same
/// thing despite the case and punctuation differences a manually-maintained
/// spreadsheet tends to accumulate.
export function normalizeForMatch(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]/g, "");
}

// A couple of category names the monthly report (Section 8.1) spells out
// differently enough that stripping punctuation alone doesn't bridge the
// gap - unlike everything else, this is a genuine wording difference
// ("3.785 Liters" vs the app's abbreviated "3.785L"), not just formatting.
// Keyed and valued by normalizeForMatch's own output.
const CATEGORY_ALIASES: Record<string, string> = {
  premium3785literspet: "premium3785lpet",
};

/// Like normalizeForMatch, but also resolves a category name through
/// CATEGORY_ALIASES first - used for every category comparison so a report
/// category and the app's own category are recognized as the same thing
/// regardless of which side (if either) needed the alias.
export function categoryKey(s: string): string {
  const normalized = normalizeForMatch(s);
  return CATEGORY_ALIASES[normalized] ?? normalized;
}

/// Resolves one imported row's raw product name (+ category, when known) to
/// the matching row in `rows`. Product names repeat across categories (e.g.
/// "Sweet A" exists in both Class A (Liter) and Class A (Gallon)) - matching
/// on category too, whenever it's known (an explicit column, or an inferred
/// section header - see CsvTools.tsx's currentCategory tracking), avoids
/// silently updating the wrong SKU. When category is undefined, the first
/// name-only match wins - only safe when the file has no duplicate names
/// across categories, or always resolves its own category by then.
export function findMatchingProduct<T extends { product: { name: string; category: string } }>(
  rows: T[],
  productName: string,
  category: string | undefined,
): T | undefined {
  return rows.find(
    (r) =>
      normalizeForMatch(r.product.name) === normalizeForMatch(productName) &&
      (category === undefined || categoryKey(r.product.category) === categoryKey(category)),
  );
}
