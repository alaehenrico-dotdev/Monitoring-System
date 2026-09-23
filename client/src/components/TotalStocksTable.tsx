import { Fragment, useState, type CSSProperties } from "react";
import type { TotalStockRow } from "../types";
import { colors } from "../theme";
import { RowGlowScroll } from "./RowGlowScroll";
import { ChevronIcon } from "./icons";

/**
 * Section 4.5 - the Total Stocks grid, extracted so both TotalStocksPage and
 * the Daily Report render the exact same table instead of the Daily Report
 * hand-rolling its own (buggy) version. Grouped by category with a subtotal
 * row per category and a grand total row, matching Section 3.1's pattern for
 * every other grid in the app - Total Stocks was the one place missing it.
 */
export function TotalStocksTable({ rows }: { rows: TotalStockRow[] }) {
  // See StockGrid's identical `expandedOverride` state - categories start
  // collapsed (absent from this map) and only expand once explicitly
  // clicked open; kept per-table-instance rather than shared, so expanding a
  // category in Total Stocks doesn't also expand it in the Daily Report's
  // copy of this same table.
  const [expandedOverride, setExpandedOverride] = useState<Record<string, boolean>>({});

  const groups = new Map<string, TotalStockRow[]>();
  for (const row of rows) {
    const list = groups.get(row.product.category) ?? [];
    list.push(row);
    groups.set(row.product.category, list);
  }

  const grandTotal = rows.reduce((sum, r) => sum + r.totalRemainingStock, 0);

  return (
    <RowGlowScroll>
      <table className="ae-table ae-table--center-head" style={{ minWidth: 640 }}>
        <thead>
          <tr>
            {["SKU", "Product", "Online Remaining", "Offline Remaining", "Total Remaining", "Manual Count", "Variance"].map((h) => (
              <th key={h}>{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {[...groups.entries()].map(([category, groupRows]) => {
            const isCollapsed = !expandedOverride[category];
            return (
            <Fragment key={category}>
              <tr>
                <td colSpan={7} style={{ padding: 0 }}>
                  <button
                    type="button"
                    onClick={() => setExpandedOverride((e) => ({ ...e, [category]: isCollapsed }))}
                    aria-expanded={!isCollapsed}
                    title={isCollapsed ? `Expand ${category}` : `Collapse ${category}`}
                    style={categoryToggleStyle}
                  >
                    <span style={{ display: "inline-flex", transform: isCollapsed ? "rotate(-90deg)" : "none", transition: "transform 120ms ease" }}>
                      <ChevronIcon />
                    </span>
                    {category}
                  </button>
                </td>
              </tr>
              {groupRows.map((r) => (
                <tr
                  key={r.product.id}
                  className={isCollapsed ? "ae-row-collapsed" : undefined}
                  style={r.totalVariance ? { background: colors.warningBg } : undefined}
                >
                  <td style={skuCellStyle}>{r.product.sku ?? "—"}</td>
                  <td style={nameCellStyle}>{r.product.name}</td>
                  <td>{r.onlineRemainingStock.toLocaleString()}</td>
                  <td>{r.offlineRemainingStock.toLocaleString()}</td>
                  <td style={{ fontWeight: 600 }}>{r.totalRemainingStock.toLocaleString()}</td>
                  <td>{r.totalManualCount ?? "—"}</td>
                  <td>{r.totalVariance ?? "—"}</td>
                </tr>
              ))}
              <tr style={subtotalRowStyle}>
                <td colSpan={2} style={nameCellStyle}>Subtotal - {category}</td>
                <td>{groupRows.reduce((s, r) => s + r.onlineRemainingStock, 0).toLocaleString()}</td>
                <td>{groupRows.reduce((s, r) => s + r.offlineRemainingStock, 0).toLocaleString()}</td>
                <td>{groupRows.reduce((s, r) => s + r.totalRemainingStock, 0).toLocaleString()}</td>
                <td colSpan={2} />
              </tr>
            </Fragment>
            );
          })}
          <tr style={grandTotalRowStyle}>
            <td colSpan={2} style={nameCellStyle}>GRAND TOTAL</td>
            <td>{rows.reduce((s, r) => s + r.onlineRemainingStock, 0).toLocaleString()}</td>
            <td>{rows.reduce((s, r) => s + r.offlineRemainingStock, 0).toLocaleString()}</td>
            <td>{grandTotal.toLocaleString()}</td>
            <td colSpan={2} />
          </tr>
        </tbody>
      </table>
    </RowGlowScroll>
  );
}

const nameCellStyle: CSSProperties = { textAlign: "left", whiteSpace: "nowrap", color: colors.ink };
const skuCellStyle: CSSProperties = { textAlign: "left", whiteSpace: "nowrap", color: colors.yellow, fontVariantNumeric: "tabular-nums" };
// See StockGrid's identical categoryToggleStyle - a real <button> spanning
// every column so the expand/collapse arrow has one clickable/keyboard-
// focusable target instead of a styled, inert <td>.
const categoryToggleStyle: CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 6,
  width: "100%",
  textAlign: "left",
  font: "inherit",
  fontWeight: 700,
  padding: "6px 8px",
  border: "none",
  borderLeft: `4px solid ${colors.red}`,
  background: "var(--ae-category-bg)",
  color: colors.yellow,
  cursor: "pointer",
};
const subtotalRowStyle: CSSProperties = { fontWeight: 600, background: colors.paperAlt };
const grandTotalRowStyle: CSSProperties = { fontWeight: 700, background: colors.warningBg, borderTop: `2px solid ${colors.black}` };