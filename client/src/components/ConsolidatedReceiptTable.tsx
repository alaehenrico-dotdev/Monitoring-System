import { Fragment, useState, type CSSProperties } from "react";
import type { ConsolidatedReceiptData } from "../utils/consolidatedReceipts";
import { formatQty } from "../utils/consolidatedReceipts";
import { colors } from "../theme";
import { RowGlowScroll } from "./RowGlowScroll";
import { ChevronIcon } from "./icons";

/**
 * Section 4.7 - Consolidated Receipt: one column per Receipt (grouped by
 * location/area), one row per product (grouped by category, same
 * expand/collapse-by-category treatment as StockGrid/TotalStocksTable), each
 * cell the product's quantity on that receipt. A subtotal row closes each
 * category and a grand-total row closes the table, both per receipt column -
 * matching Section 3.1's pattern for every other grid, just transposed.
 */
// The three header rows are each `position: sticky` (from .ae-table th), so
// without an explicit `top` they'd all stick to the same spot and overlap
// on vertical scroll - stacking them at multiples of one row's height keeps
// all three visible, one under the next, the way a single sticky header row
// already works everywhere else in the app.
const HEADER_ROW_HEIGHT = 29;

export function ConsolidatedReceiptTable({
  data,
}: {
  data: ConsolidatedReceiptData;
}) {
  const [expandedOverride, setExpandedOverride] = useState<
    Record<string, boolean>
  >({});
  const totalCols = 2 + data.columns.length + 1;

  if (data.columns.length === 0) {
    return (
      <p style={{ color: colors.subtleInk }}>No receipts for this date.</p>
    );
  }

  return (
    <RowGlowScroll>
      <table
        className="ae-table ae-table--left"
        style={{ minWidth: 640 + data.columns.length * 64 }}
      >
        <thead>
          <tr>
            <th colSpan={2} style={{ top: 0, verticalAlign: "bottom" }}>
              Product
            </th>
            {data.locationGroups.map((g) => (
              <th
                key={g.location}
                colSpan={g.columns.length}
                style={{
                  top: 0,
                  textAlign: "center",
                  background: colors.black,
                  color: colors.yellow,
                }}
              >
                {g.location}
              </th>
            ))}
            <th
              rowSpan={3}
              style={{ top: 0, textAlign: "center", verticalAlign: "bottom" }}
            >
              Total Order
            </th>
          </tr>
          <tr>
            <th style={{ top: HEADER_ROW_HEIGHT }} />
            <th style={{ top: HEADER_ROW_HEIGHT }} />
            {data.columns.map((c) => (
              <th
                key={c.receiptId}
                style={{
                  top: HEADER_ROW_HEIGHT,
                  textAlign: "center",
                  whiteSpace: "normal",
                  maxWidth: 90,
                }}
                title={
                  c.salesRepName ? `Sales Rep: ${c.salesRepName}` : undefined
                }
              >
                {c.customer}
              </th>
            ))}
          </tr>
          <tr>
            <th style={{ top: HEADER_ROW_HEIGHT * 2 }}>SKU</th>
            <th style={{ top: HEADER_ROW_HEIGHT * 2 }}>Product</th>
            {data.columns.map((c) => (
              <th
                key={c.receiptId}
                style={{
                  top: HEADER_ROW_HEIGHT * 2,
                  textAlign: "center",
                  fontWeight: 400,
                  color: colors.subtleInk,
                }}
              >
                {c.receiptLabel}
              </th>
            ))}
          </tr>
        </thead>

        <tbody>
          {data.categoryGroups.map((group) => {
            const isCollapsed = !expandedOverride[group.category];
            return (
              <Fragment key={group.category}>
                <tr>
                  <td colSpan={totalCols} style={{ padding: 0 }}>
                    <button
                      type="button"
                      onClick={() =>
                        setExpandedOverride((e) => ({
                          ...e,
                          [group.category]: isCollapsed,
                        }))
                      }
                      aria-expanded={!isCollapsed}
                      aria-controls={group.rows.map((row) => `ae-receipttable-row-${row.product.id}`).join(" ")}
                      title={
                        isCollapsed
                          ? `Expand ${group.category}`
                          : `Collapse ${group.category}`
                      }
                      style={categoryToggleStyle}
                    >
                      <span
                        style={{
                          display: "inline-flex",
                          transform: isCollapsed ? "rotate(-90deg)" : "none",
                          transition: "transform 260ms cubic-bezier(0.22, 1, 0.36, 1)",
                        }}
                      >
                        <ChevronIcon />
                      </span>
                      {group.category}
                    </button>
                  </td>
                </tr>

                {group.rows.map((row, i) => (
                  <tr
                    key={row.product.id}
                    id={`ae-receipttable-row-${row.product.id}`}
                    className={isCollapsed ? "ae-cat-row ae-row-collapsed" : "ae-cat-row"}
                    style={{ "--ae-row-i": i } as CSSProperties}
                  >
                    <td style={skuCellStyle}>{row.product.sku ?? "\u2014"}</td>
                    <td style={nameCellStyle}>{row.product.name}</td>
                    {data.columns.map((c) => (
                      <td key={c.receiptId} style={numCellStyle}>
                        {formatQty(row.valuesByReceiptId[c.receiptId])}
                      </td>
                    ))}
                    <td style={{ ...numCellStyle, fontWeight: 600 }}>{formatQty(row.total)}</td>
                  </tr>
                ))}

                <tr style={subtotalRowStyle}>
                  <td colSpan={2} style={nameCellStyle}>
                    Subtotal - {group.category}
                  </td>
                  {data.columns.map((c) => (
                    <td key={c.receiptId} style={numCellStyle}>
                      {formatQty(group.subtotalByReceiptId[c.receiptId])}
                    </td>
                  ))}
                  <td style={numCellStyle}>{formatQty(group.subtotalTotal)}</td>
                </tr>
              </Fragment>
            );
          })}

          <tr style={grandTotalRowStyle}>
            <td colSpan={2} style={nameCellStyle}>
              GRAND TOTAL
            </td>
            {data.columns.map((c) => (
              <td key={c.receiptId} style={numCellStyle}>
                {formatQty(data.grandTotalByReceiptId[c.receiptId])}
              </td>
            ))}
            <td style={numCellStyle}>{formatQty(data.grandTotal)}</td>
          </tr>
        </tbody>
      </table>
    </RowGlowScroll>
  );
}

const nameCellStyle: CSSProperties = {
  textAlign: "left",
  whiteSpace: "nowrap",
  color: colors.ink,
};
const skuCellStyle: CSSProperties = {
  textAlign: "left",
  whiteSpace: "nowrap",
  color: colors.yellow,
  fontVariantNumeric: "tabular-nums",
};
// This table uses ae-table--left (so its td default is left, for the
// SKU/Product text columns) - the numeric quantity columns need their own
// explicit centering since they don't inherit the base .ae-table td rule.
const numCellStyle: CSSProperties = { textAlign: "center" };
// Same treatment as StockGrid/TotalStocksTable's identical style - a real
// <button> spanning every column so the expand/collapse arrow has one
// clickable/keyboard-focusable target instead of a styled, inert <td>.
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
const subtotalRowStyle: CSSProperties = {
  fontWeight: 600,
  background: colors.paperAlt,
};
const grandTotalRowStyle: CSSProperties = {
  fontWeight: 700,
  background: colors.warningBg,
  borderTop: `2px solid ${colors.black}`,
};