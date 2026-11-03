import type { GridRow } from "./StockGrid";
import { hasNegativeValue, type RowFilter } from "../hooks/useGridView";

const num = (v: unknown) => (typeof v === "number" ? v : Number(v) || 0);

/// Three quick figures above an entry grid, read from the rows the grid already shows (so an
/// unsaved edit is reflected): total remaining stock, products below zero (click to filter to
/// them, click again to clear), and products with unsaved edits.
export function EntryTotalsStrip({
  rows,
  rowFilter,
  onRowFilterChange,
  changed,
}: {
  rows: GridRow[];
  rowFilter: RowFilter;
  onRowFilterChange: (f: RowFilter) => void;
  changed: number;
}) {
  const remaining = rows.reduce((sum, r) => sum + num(r.entry.remainingStock), 0);
  const negative = rows.filter(hasNegativeValue).length;
  const showingNegative = rowFilter === "negative";
  return (
    <div className="ae-entry-totals" role="group" aria-label="Sheet totals">
      <div className="ae-entry-total">
        <span className="ae-entry-total-value">{remaining.toLocaleString()}</span>
        <span className="ae-entry-total-label">Total remaining stock</span>
      </div>
      <button
        type="button"
        className={`ae-entry-total ae-entry-total--action${negative > 0 ? " ae-entry-total--bad" : ""}${showingNegative ? " ae-entry-total--on" : ""}`}
        aria-pressed={showingNegative}
        disabled={negative === 0 && !showingNegative}
        title={showingNegative ? "Show all rows" : "Show only the products below zero"}
        onClick={() => onRowFilterChange(showingNegative ? "all" : "negative")}
      >
        <span className="ae-entry-total-value">{negative}</span>
        <span className="ae-entry-total-label">Below zero</span>
      </button>
      <div className="ae-entry-total">
        <span className="ae-entry-total-value">{changed}</span>
        <span className="ae-entry-total-label">Edited, unsaved</span>
      </div>
    </div>
  );
}
