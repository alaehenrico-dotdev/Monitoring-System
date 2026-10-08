import { Fragment, useState } from "react";
import type { StockLocation, TotalStockRow } from "../types";
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
// Height of the single sticky header row (`.ae-table th`'s own `top: 0` /
// `position: sticky`) - where a category row's own sticky offset starts, so
// it sits right under the header rather than overlapping it.
const HEADER_ROW_HEIGHT = 26;

/// A product is "low stock" only once an admin has configured a threshold
/// for it (ProductsAdminPage) - null means no alert is configured, not an
/// alert at zero, so it never fires for the majority of SKUs that have
/// never had one set.
function isLowStock(row: TotalStockRow): boolean {
  return (
    row.product.lowStockThreshold !== null &&
    row.totalRemainingStock <= row.product.lowStockThreshold
  );
}

export function TotalStocksTable({
  rows,
  source = "TOTAL",
}: {
  rows: TotalStockRow[];
  // Which remaining-stock column(s) to show - "TOTAL" (default) keeps the
  // original Online + Offline + Total layout so DailyReportPage's existing
  // call (which never passes this) is unaffected. "ONLINE"/"OFFLINE" narrow
  // the grid to just that channel's column, from StockSourceFilter on
  // TotalStocksPage.
  source?: StockLocation;
}) {
  // See StockGrid's identical `expandedOverride` state - categories start
  // collapsed (absent from this map) and only expand once explicitly
  // clicked open; kept per-table-instance rather than shared, so expanding a
  // category in Total Stocks doesn't also expand it in the Daily Report's
  // copy of this same table.
  const [expandedOverride, setExpandedOverride] = useState<
    Record<string, boolean>
  >({});

  const groups = new Map<string, TotalStockRow[]>();
  for (const row of rows) {
    const list = groups.get(row.product.category) ?? [];
    list.push(row);
    groups.set(row.product.category, list);
  }

  const grandTotal = rows.reduce((sum, r) => sum + r.totalRemainingStock, 0);

  // Which remaining-stock column(s) are visible for the current source
  // filter - "TOTAL" shows all three (the original layout), "ONLINE"/
  // "OFFLINE" narrow the grid down to just that one channel.
  const showOnline = source !== "OFFLINE";
  const showOffline = source !== "ONLINE";
  const showTotal = source === "TOTAL";
  const columnCount =
    2 + Number(showOnline) + Number(showOffline) + Number(showTotal);

  return (
    <RowGlowScroll>
      <table className="ae-table ae-table--center-head ae-table--compact">
        <thead>
          <tr>
            {[
              "SKU",
              "Product",
              ...(showOnline ? ["Online Remaining"] : []),
              ...(showOffline ? ["Offline Remaining"] : []),
              ...(showTotal ? ["Total Remaining"] : []),
            ].map((h) => (
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
                  {/* Sticky Scroll (CSS-only, no JS): pinned right under the
                      header while this category's rows scroll by; once they
                      scroll past, the next category's own row reaches the
                      same top offset and, being later in the DOM (painted
                      after), simply covers this one - the standard sticky-
                      header handoff. This table's column count varies with
                      `source`, so it never scrolls horizontally either way -
                      only the vertical stick is needed here. */}
                  <td
                    colSpan={columnCount}
                    style={{
                      padding: 0,
                      position: "sticky",
                      top: HEADER_ROW_HEIGHT,
                      zIndex: 2,
                    }}
                  >
                    <button
                      type="button"
                      onClick={() =>
                        setExpandedOverride((e) => ({
                          ...e,
                          [category]: isCollapsed,
                        }))
                      }
                      aria-expanded={!isCollapsed}
                      aria-controls={groupRows
                        .map((r) => `ae-totalstocks-row-${r.product.id}`)
                        .join(" ")}
                      title={
                        isCollapsed
                          ? `Expand ${category}`
                          : `Collapse ${category}`
                      }
                      className="ae-cat-toggle"
                    >
                      <span className="ae-cat-label">
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
                        {category}
                      </span>
                    </button>
                  </td>
                </tr>
                {groupRows.map((r) => {
                  const lowStock = isLowStock(r);
                  return (
                    <tr
                      key={r.product.id}
                      id={`ae-totalstocks-row-${r.product.id}`}
                      className={
                        isCollapsed
                          ? "ae-cat-row ae-row-collapsed"
                          : "ae-cat-row"
                      }
                      style={
                        // Low Stock takes priority over the variance tint - a
                        // product actually running low matters more right now
                        // than a manual-count mismatch.
                        lowStock
                          ? { background: colors.dangerBg }
                          : r.totalVariance
                            ? { background: colors.warningBg }
                            : undefined
                      }
                    >
                      <td className="ae-cell-sku">{r.product.sku ?? "—"}</td>
                      <td className="ae-cell-name">
                        {r.product.name}
                        {lowStock && (
                          <span
                            title={`At or below the low stock alert (${r.product.lowStockThreshold} ${r.product.unit})`}
                            style={{
                              marginLeft: 8,
                              padding: "1px 7px",
                              border: `1px solid ${colors.danger}`,
                              borderRadius: 6,
                              fontSize: 10.5,
                              fontWeight: 700,
                              letterSpacing: "0.04em",
                              textTransform: "uppercase",
                              color: colors.danger,
                            }}
                          >
                            Low Stock
                          </span>
                        )}
                      </td>
                      {showOnline && (
                        <td>{r.onlineRemainingStock.toLocaleString()}</td>
                      )}
                      {showOffline && (
                        <td>{r.offlineRemainingStock.toLocaleString()}</td>
                      )}
                      {showTotal && (
                        <td style={{ fontWeight: 600 }}>
                          {r.totalRemainingStock.toLocaleString()}
                        </td>
                      )}
                    </tr>
                  );
                })}
                <tr className="ae-row-subtotal">
                  <td colSpan={2} className="ae-cell-name">
                    Subtotal - {category}
                  </td>
                  {showOnline && (
                    <td>
                      {groupRows
                        .reduce((s, r) => s + r.onlineRemainingStock, 0)
                        .toLocaleString()}
                    </td>
                  )}
                  {showOffline && (
                    <td>
                      {groupRows
                        .reduce((s, r) => s + r.offlineRemainingStock, 0)
                        .toLocaleString()}
                    </td>
                  )}
                  {showTotal && (
                    <td>
                      {groupRows
                        .reduce((s, r) => s + r.totalRemainingStock, 0)
                        .toLocaleString()}
                    </td>
                  )}
                </tr>
              </Fragment>
            );
          })}
          <tr className="ae-row-grand">
            <td colSpan={2} className="ae-cell-name">
              GRAND TOTAL
            </td>
            {showOnline && (
              <td>
                {rows
                  .reduce((s, r) => s + r.onlineRemainingStock, 0)
                  .toLocaleString()}
              </td>
            )}
            {showOffline && (
              <td>
                {rows
                  .reduce((s, r) => s + r.offlineRemainingStock, 0)
                  .toLocaleString()}
              </td>
            )}
            {showTotal && <td>{grandTotal.toLocaleString()}</td>}
          </tr>
        </tbody>
      </table>
    </RowGlowScroll>
  );
}
