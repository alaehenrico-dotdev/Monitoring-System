import type { Cell, PdfTable } from "./tablesPdf";

/**
 * "Hide empty rows / columns" for the report tables.
 *
 * A row is EMPTY when every figure in it is zero (or blank): a product with no
 * opening stock, no movement and no closing stock that day. A column is EMPTY
 * when it is zero for every product (an unused Backloads, an added column with no
 * amounts). Nothing with any figure in it is ever hidden, so totals do not change.
 */
export interface HideOptions {
  hideEmptyRows: boolean;
  hideEmptyColumns: boolean;
}

export const SHOW_ALL: HideOptions = { hideEmptyRows: false, hideEmptyColumns: false };

const isZero = (cell: Cell): boolean => cell === null || cell === undefined || cell === "" || cell === 0 || cell === "-";

export interface HideResult {
  table: PdfTable;
  hiddenRows: number;
  hiddenColumns: string[];
}

/// `firstFigure`: the index of the first figure column (the columns before it,
/// Category / SKU / Product, are labels and are never hidden or counted).
export function hideEmpty(table: PdfTable, firstFigure: number, options: HideOptions): HideResult {
  let columns = table.columns;
  let rows = table.rows;
  let hiddenRows = 0;
  const hiddenColumns: string[] = [];

  if (options.hideEmptyColumns && rows.length > 0) {
    const figureIndexes = columns.map((_, i) => i).filter((i) => i >= firstFigure);
    const empty = figureIndexes.filter((i) => rows.every((r) => isZero(r[i])));
    // A table with no figure column left would be just a list of names: keep them all then.
    if (empty.length > 0 && empty.length < figureIndexes.length) {
      const drop = new Set(empty);
      hiddenColumns.push(...empty.map((i) => columns[i]));
      columns = columns.filter((_, i) => !drop.has(i));
      rows = rows.map((r) => r.filter((_, i) => !drop.has(i)));
    }
  }

  if (options.hideEmptyRows) {
    const keep = rows.filter((r) => r.slice(firstFigure).some((cell) => !isZero(cell)));
    hiddenRows = rows.length - keep.length;
    rows = keep;
  }

  return { table: { ...table, columns, rows }, hiddenRows, hiddenColumns };
}

/// One line for the report's Summary saying what was left out, so nobody wonders
/// why a product is not listed. Null when nothing was hidden.
export function describeHidden(parts: { name: string; hiddenRows: number; hiddenColumns: string[] }[]): { rows: string | null; columns: string | null } {
  const rows = parts.filter((p) => p.hiddenRows > 0).map((p) => `${p.name} ${p.hiddenRows}`);
  const columns = parts.filter((p) => p.hiddenColumns.length > 0).map((p) => `${p.name}: ${p.hiddenColumns.join(", ")}`);
  return { rows: rows.length ? rows.join(", ") : null, columns: columns.length ? columns.join("; ") : null };
}
