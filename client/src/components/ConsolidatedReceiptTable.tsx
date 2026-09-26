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
// Where a category row sticks once scrolled up to it - directly under the
// stacked header (see above), not the very top of the scroll container. The
// page itself never scrolls (Layout.tsx's .app-shell is a fixed 100vh, only
// its <main> - .ae-main - has overflow-y: auto), and .ae-main is exactly the
// scrolling ancestor the header rows above already stick relative to, so
// this lines up with them for free.
const CATEGORY_ROW_TOP = HEADER_ROW_HEIGHT * 3;

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
                  {/* Sticky on both axes, independently. This <td> sticks
                      vertically (top: CATEGORY_ROW_TOP, right under the
                      header stack): while this category is expanded and its
                      rows are scrolled through, the band stays pinned there;
                      once its rows scroll past, the next category's own row
                      reaches the same top offset and - being later in the
                      DOM, so painted after - simply covers the previous one.
                      Standard sticky-header handoff, no JS needed. The
                      row's own background band spans every column (unlike
                      StockGrid/TotalStocksTable, this table's column count
                      is unbounded - one per receipt - so it scrolls
                      horizontally as a matter of course too) so the colored
                      band still covers the full row width once scrolled; the
                      nested button is the piece that sticks horizontally
                      (left: 0, see categoryToggleStyle), so the label/
                      chevron stays visible on both scroll axes at once. */}
                  <td
                    colSpan={totalCols}
                    style={{
                      padding: 0,
                      background: "var(--ae-category-bg)",
                      position: "sticky",
                      top: CATEGORY_ROW_TOP,
                      zIndex: 2,
                    }}
                  >
                    <button
                      type="button"
                      onClick={() =>
                        setExpandedOverride((e) => ({
                          ...e,
                          [group.category]: isCollapsed,
                        }))
                      }
                      aria-expanded={!isCollapsed}
                      aria-controls={group.rows
                        .map((row) => `ae-receipttable-row-${row.product.id}`)
                        .join(" ")}
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
                          transition:
                            "transform 260ms cubic-bezier(0.22, 1, 0.36, 1)",
                        }}
                      >
                        <ChevronIcon />
                      </span>
                      {group.category}
                    </button>
                  </td>
                </tr>

                {group.rows.map((row) => (
                  <tr
                    key={row.product.id}
                    id={`ae-receipttable-row-${row.product.id}`}
                    className={
                      isCollapsed ? "ae-cat-row ae-row-collapsed" : "ae-cat-row"
                    }
                  >
                    <td style={skuCellStyle}>{row.product.sku ?? "\u2014"}</td>
                    <td style={nameCellStyle} title={row.product.name}>{row.product.name}</td>
                    {data.columns.map((c) => (
                      <td key={c.receiptId} style={numCellStyle}>
                        {formatQty(row.valuesByReceiptId[c.receiptId])}
                      </td>
                    ))}
                    <td style={{ ...numCellStyle, fontWeight: 600 }}>
                      {formatQty(row.total)}
                    </td>
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
  overflow: "hidden",
  textOverflow: "ellipsis",
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
// Same clickable-spanning-<button> idea as StockGrid/TotalStocksTable's own
// categoryToggleStyle, but NOT identical: this table's columns are unbounded
// (one per receipt) and horizontal scroll is the norm here, unlike those two
// - so unlike their width:100% (which just fills a spanned cell that's
// already fully in view), this one is `position: sticky; left: 0` with a
// content-sized (not 100%) width, so the label stays pinned to the left edge
// as the table scrolls horizontally instead of scrolling away with the rest
// of the row. Its own background matches the <td>'s band color (see the
// caller) so the sticky label reads as part of the row, not a separate
// floating chip, and z-index 2 matches the app's other horizontal-sticky
// convention (.ae-bulk-fixed-col in index.css) so it stays above the
// table's own sticky vertical header (z-index 1) if the two ever overlap.
const categoryToggleStyle: CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  gap: 6,
  width: "max-content",
  position: "sticky",
  left: 0,
  zIndex: 2,
  textAlign: "left",
  font: "inherit",
  fontWeight: 700,
  padding: "5px 6px",
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
