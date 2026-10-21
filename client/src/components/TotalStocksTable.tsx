import { Fragment, useEffect, useRef, useState } from "react";
import type { StockLocation, TotalStockRow } from "../types";
import { colors } from "../theme";
import { sumRounded } from "../utils/gridFormat";
import { isLowStock } from "../utils/lowStock";
import { RowGlowScroll } from "./RowGlowScroll";
import { GridSelectionBar } from "./GridSelectionBar";
import { copyRowsToClipboard, useRowSelection } from "../hooks/useRowSelection";
import { toTsv } from "../utils/rowSelection";
import { ChevronIcon } from "./icons";
import { useCategoryReveal } from "../hooks/useCategoryReveal";

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

export function TotalStocksTable({
  rows,
  source = "TOTAL",
  expandAllCommand,
  onAnyExpandedChange,
  fit = false,
}: {
  rows: TotalStockRow[];
  /// Stretch the columns to fill the pane (View > Fit table to width) instead
  /// of sizing them to their content.
  fit?: boolean;
  /// Same contract as StockGrid's: a new `id` expands or collapses every category.
  expandAllCommand?: { expanded: boolean; id: number } | null;
  /// Reports whether any category is open, so the page's menu can say
  /// "Expand all" or "Collapse all".
  onAnyExpandedChange?: (anyExpanded: boolean) => void;
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
  // Fades a category's rows in and out when it is toggled (hooks/useCategoryReveal.ts).
  const reveal = useCategoryReveal();

  const groups = new Map<string, TotalStockRow[]>();
  for (const row of rows) {
    const list = groups.get(row.product.category) ?? [];
    list.push(row);
    groups.set(row.product.category, list);
  }

  const anyExpanded = [...groups.keys()].some((c) => expandedOverride[c]);
  const appliedCommandId = useRef(expandAllCommand?.id);
  useEffect(() => {
    if (!expandAllCommand || expandAllCommand.id === appliedCommandId.current) return;
    appliedCommandId.current = expandAllCommand.id;
    const next: Record<string, boolean> = {};
    for (const category of groups.keys()) next[category] = expandAllCommand.expanded;
    setExpandedOverride(next);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [expandAllCommand]);
  useEffect(() => {
    onAnyExpandedChange?.(anyExpanded);
  }, [anyExpanded, onAnyExpandedChange]);

  const grandTotal = sumRounded(rows.map((r) => r.totalRemainingStock));

  // Which remaining-stock column(s) are visible for the current source
  // filter - "TOTAL" shows all three (the original layout), "ONLINE"/
  // "OFFLINE" narrow the grid down to just that one channel.
  const showOnline = source !== "OFFLINE";
  const showOffline = source !== "ONLINE";
  const showTotal = source === "TOTAL";
  const columnCount =
    2 + Number(showOnline) + Number(showOffline) + Number(showTotal);

  // Row selection (hooks/useRowSelection.ts): press the SKU/Product cell, Shift+press
  // for a range, Ctrl/Cmd+press to add or remove one, or press and drag. Read-only,
  // so what it offers is the selected rows' totals and Copy. A collapsed category's
  // rows are not on screen and so not part of it.
  const visibleIds = [...groups.entries()].flatMap(([category, groupRows]) =>
    expandedOverride[category] ? groupRows.map((r) => r.product.id) : [],
  );
  const selection = useRowSelection({
    visibleIds,
    onCopy: copySelected,
  });
  const selectedRows = selection.selected.flatMap((id) => rows.find((r) => r.product.id === id) ?? []);

  function copySelected(ids: number[]) {
    const picked = ids.flatMap((id) => rows.find((r) => r.product.id === id) ?? []);
    copyRowsToClipboard(
      toTsv(
        [
          "SKU",
          "Product",
          ...(showOnline ? ["Online Remaining"] : []),
          ...(showOffline ? ["Offline Remaining"] : []),
          ...(showTotal ? ["Consolidated Remaining"] : []),
        ],
        picked.map((r) => [
          r.product.sku ?? "",
          r.product.name,
          ...(showOnline ? [String(r.onlineRemainingStock)] : []),
          ...(showOffline ? [String(r.offlineRemainingStock)] : []),
          ...(showTotal ? [String(r.totalRemainingStock)] : []),
        ]),
      ),
      picked.length,
    );
  }

  return (
    <>
    {selection.selected.length > 0 && (
      <GridSelectionBar
        count={selection.selected.length}
        fillTargets={null}
        onFill={() => {}}
        onCopy={() => copySelected(selection.selected)}
        onDeselect={selection.clear}
      />
    )}
    <RowGlowScroll>
      <table className={`ae-table ae-table--center-head ae-table--compact ae-table--pickable${fit ? " ae-table--fit" : ""}`}>
        <thead>
          <tr>
            {[
              "SKU",
              "Product",
              ...(showOnline ? ["Online Remaining"] : []),
              ...(showOffline ? ["Offline Remaining"] : []),
              ...(showTotal ? ["Consolidated Remaining"] : []),
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
                        reveal.toggle(category, !isCollapsed, true, () =>
                          setExpandedOverride((e) => ({ ...e, [category]: isCollapsed })),
                        )
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
                            transform:
                              isCollapsed || reveal.closing(category)
                                ? "rotate(-90deg)"
                                : "none",
                            transition:
                              "transform 160ms cubic-bezier(0.22, 1, 0.36, 1)",
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
                        (isCollapsed
                          ? "ae-cat-row ae-row-collapsed"
                          : "ae-cat-row") +
                        reveal.rowClass(category) +
                        (selection.selectedSet.has(r.product.id)
                          ? " ae-row-selected"
                          : "")
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
                      <td
                        className="ae-cell-sku ae-row-pick"
                        onMouseDown={(e) => selection.press(e, r.product.id)}
                        onMouseEnter={() => selection.enter(r.product.id)}
                      >
                        {r.product.sku ?? "—"}
                      </td>
                      <td
                        className="ae-cell-name ae-row-pick"
                        onMouseDown={(e) => selection.press(e, r.product.id)}
                        onMouseEnter={() => selection.enter(r.product.id)}
                        title="Click to select the row - Shift+click for a range, Ctrl+click to add"
                      >
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
                      {sumRounded(groupRows.map((r) => r.onlineRemainingStock))
                        .toLocaleString()}
                    </td>
                  )}
                  {showOffline && (
                    <td>
                      {sumRounded(groupRows.map((r) => r.offlineRemainingStock))
                        .toLocaleString()}
                    </td>
                  )}
                  {showTotal && (
                    <td>
                      {sumRounded(groupRows.map((r) => r.totalRemainingStock))
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
                {sumRounded(rows.map((r) => r.onlineRemainingStock))
                  .toLocaleString()}
              </td>
            )}
            {showOffline && (
              <td>
                {sumRounded(rows.map((r) => r.offlineRemainingStock))
                  .toLocaleString()}
              </td>
            )}
            {showTotal && <td>{grandTotal.toLocaleString()}</td>}
          </tr>
        </tbody>
        {selection.selected.length > 0 && (
          // The selection's own totals, pinned to the bottom edge.
          <tfoot className="no-print">
            <tr className="ae-row-selected-total">
              <td colSpan={2}>SELECTED ({selection.selected.length})</td>
              {showOnline && (
                <td>{sumRounded(selectedRows.map((r) => r.onlineRemainingStock)).toLocaleString()}</td>
              )}
              {showOffline && (
                <td>{sumRounded(selectedRows.map((r) => r.offlineRemainingStock)).toLocaleString()}</td>
              )}
              {showTotal && (
                <td>{sumRounded(selectedRows.map((r) => r.totalRemainingStock)).toLocaleString()}</td>
              )}
            </tr>
          </tfoot>
        )}
      </table>
    </RowGlowScroll>
    </>
  );
}
