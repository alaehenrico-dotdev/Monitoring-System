import { extraColumnKey } from "../hooks/useExtraColumns";

/**
 * "Hide empty rows / columns" for the Daily Report page (View menu): the screen,
 * the PDF button and Excel all read from the same trimmed view.
 *
 * A row is EMPTY when every figure in it is zero or blank (a product with no
 * stock and no movement that day). A column is EMPTY when it is zero for every
 * product. Anything with a figure in it is never hidden, so totals do not change.
 * The matching rules for the PDF saved to Google Drive live on the server
 * (server/src/utils/hideEmpty.ts); keep the two in step.
 */
export interface HideFlags {
  rows: boolean;
  columns: boolean;
}

interface StockRow {
  product: { category: string };
  entry: Record<string, unknown>;
}

const isZero = (v: unknown): boolean => {
  if (v === null || v === undefined || v === "") return true;
  const n = Number(v);
  return Number.isFinite(n) ? n === 0 : false;
};

export interface StockView<R, C> {
  rows: R[];
  columns: C[];
  /// Added columns still shown, by the main column they were added to.
  extras: Record<string, number[]>;
  hiddenRows: number;
  hiddenColumns: number;
}

/// An Online / Offline sheet: the main columns, the added columns after them (`extras`),
/// and the rows, optionally narrowed to one category first.
export function viewStockSheet<R extends StockRow, C extends { key: string }>(
  rows: R[],
  columns: C[],
  extras: Record<string, number[]>,
  flags: HideFlags,
  category = "",
): StockView<R, C> {
  const inCategory = category ? rows.filter((r) => r.product.category === category) : rows;
  const none: StockView<R, C> = { rows: inCategory, columns, extras, hiddenRows: 0, hiddenColumns: 0 };
  if ((!flags.rows && !flags.columns) || inCategory.length === 0) return none;

  // Every cell key the sheet shows: each main column, then its added columns.
  const keysOf = (cols: C[], ex: Record<string, number[]>) => cols.flatMap((c) => [c.key, ...(ex[c.key] ?? []).map((slot) => extraColumnKey(c.key, slot))]);
  const allKeys = keysOf(columns, extras);
  const emptyKeys = new Set(allKeys.filter((k) => inCategory.every((r) => isZero(r.entry[k]))));

  let shownColumns = columns;
  let shownExtras = extras;
  let hiddenColumns = 0;
  // A sheet with nothing but empty columns keeps them (a table of names alone is no use).
  if (flags.columns && emptyKeys.size > 0 && emptyKeys.size < allKeys.length) {
    shownColumns = columns.filter((c) => !emptyKeys.has(c.key));
    shownExtras = {};
    for (const c of shownColumns) {
      const kept = (extras[c.key] ?? []).filter((slot) => !emptyKeys.has(extraColumnKey(c.key, slot)));
      if (kept.length > 0) shownExtras[c.key] = kept;
    }
    hiddenColumns = allKeys.length - keysOf(shownColumns, shownExtras).length;
  }

  let shownRows = inCategory;
  let hiddenRows = 0;
  if (flags.rows) {
    shownRows = inCategory.filter((r) => allKeys.some((k) => !isZero(r.entry[k])));
    hiddenRows = inCategory.length - shownRows.length;
  }
  return { rows: shownRows, columns: shownColumns, extras: shownExtras, hiddenRows, hiddenColumns };
}

interface TotalRow {
  product: { category: string };
  onlineRemainingStock?: unknown;
  offlineRemainingStock?: unknown;
  totalRemainingStock?: unknown;
  totalManualCount?: unknown;
  totalVariance?: unknown;
}

/// The Consolidated table. Its columns are fixed, so only empty rows are left out of it.
export function viewTotalRows<R extends TotalRow>(rows: R[], flags: HideFlags, category = ""): { rows: R[]; hiddenRows: number } {
  const inCategory = category ? rows.filter((r) => r.product.category === category) : rows;
  if (!flags.rows) return { rows: inCategory, hiddenRows: 0 };
  const shown = inCategory.filter(
    (r) => ![r.onlineRemainingStock, r.offlineRemainingStock, r.totalRemainingStock, r.totalManualCount, r.totalVariance].every(isZero),
  );
  return { rows: shown, hiddenRows: inCategory.length - shown.length };
}

/// One line for the page saying what the switches are leaving out, or null when nothing is.
export function describeHiddenOnPage(parts: { rows: number; columns: number }): string | null {
  const bits: string[] = [];
  if (parts.rows > 0) bits.push(`${parts.rows} ${parts.rows === 1 ? "product" : "products"} with no figures`);
  if (parts.columns > 0) bits.push(`${parts.columns} empty ${parts.columns === 1 ? "column" : "columns"}`);
  return bits.length ? `Not shown: ${bits.join(" and ")}.` : null;
}
