import {
  Fragment,
  useState,
  type CSSProperties,
  type KeyboardEvent,
} from "react";
import type { Product } from "../types";
import { colors } from "../theme";
import { RowGlowScroll } from "./RowGlowScroll";
import { NumberCellInput } from "./ui";
import { ChevronIcon } from "./icons";

export interface GridRow {
  product: Product;
  entry: Record<string, unknown>;
  isSaved?: boolean;
  isFlagged?: boolean;
}

export interface GridColumn {
  key: string;
  label: string;
  editable?: boolean;
  /** Read-only calculated columns are shown but locked, like a spreadsheet formula cell (Section 3.1). */
  /** Alternate header spellings recognized on CSV import - see CsvTools.tsx; unused by the grid itself. */
  aliases?: string[];
  /**
   * Recognized on CSV import even though the live grid keeps this cell
   * locked (editable: false) - Opening Stock is normally auto-carried
   * forward from the prior day's Remaining Stock (Section 4.6), which is
   * exactly right day-to-day but leaves every product's very first date at
   * 0 with nothing to carry from. Importing a file gives that first date a
   * real starting balance instead. Unused by the grid itself.
   */
  importable?: boolean;
}

interface StockGridProps {
  rows: GridRow[];
  columns: GridColumn[];
  /** Called when an editable cell is committed (blur or Enter). */
  onCommit: (
    productId: number,
    key: string,
    value: number,
  ) => void | Promise<void>;
  readOnly?: boolean;
  /**
   * Staged-but-not-yet-saved edits, keyed by product id then column key -
   * the same shape as usePendingEntryChanges' `pending` (kept structural
   * rather than imported, to avoid a circular import - that hook already
   * imports GridRow from this file). Any category containing a pending edit
   * always renders expanded regardless of its collapsed/expanded state, so
   * an in-progress edit can never end up hidden behind a collapsed category -
   * on first load, after a CSV import stages edits across categories the
   * encoder hasn't opened, or after navigating back to a page that still has
   * edits staged. Omitted entirely on read-only tables (Daily Report), where
   * there's nothing that could ever be "pending".
   */
  pending?: Record<number, Record<string, number>>;
  /** Forwarded to RowGlowScroll - see its own doc comment. Restores/persists
   *  which product row is click-focused across navigating away and back. */
  focusStorageKey?: string;
}

function toNum(v: unknown): number {
  if (v === null || v === undefined || v === "") return 0;
  return Number(v);
}

/**
 * Section 3.1 - An Excel-Like Data Entry Experience: rows are products
 * (grouped by category, in the same order as the current sheet), cells are
 * edited in place with Tab/Enter/arrow-key navigation, calculated columns are
 * shown but not directly editable, and a subtotal row per category plus a
 * grand total row sit at the bottom of the table.
 */
export function StockGrid({
  rows,
  columns,
  onCommit,
  readOnly,
  pending,
  focusStorageKey,
}: StockGridProps) {
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  // Explicit expand/collapse choices, keyed by category name - absent means
  // "no choice made yet", which defaults to collapsed (below), not expanded.
  // Categories start collapsed so a long product list opens as a manageable
  // overview rather than every SKU at once; a category is force-expanded
  // regardless of this map whenever it has a pending edit (see `pending`
  // above), so this map alone never determines the final visible state.
  const [expandedOverride, setExpandedOverride] = useState<
    Record<string, boolean>
  >({});

  const groups = new Map<string, GridRow[]>();
  for (const row of rows) {
    const list = groups.get(row.product.category) ?? [];
    list.push(row);
    groups.set(row.product.category, list);
  }

  function cellId(productId: number, key: string) {
    return `${productId}:${key}`;
  }

  function focusCell(productId: number, key: string) {
    const el = document.querySelector<HTMLInputElement>(
      `[data-cell="${cellId(productId, key)}"]`,
    );
    el?.focus();
    el?.select();
  }

  function handleKeyDown(
    e: KeyboardEvent<HTMLInputElement>,
    productId: number,
    key: string,
    rowIds: number[],
  ) {
    const rowIndex = rowIds.indexOf(productId);
    if (e.key === "Enter" || e.key === "ArrowDown") {
      e.preventDefault();
      const nextId = rowIds[rowIndex + 1];
      if (nextId !== undefined) focusCell(nextId, key);
      e.currentTarget.blur();
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      const prevId = rowIds[rowIndex - 1];
      if (prevId !== undefined) focusCell(prevId, key);
    }
  }

  async function commit(productId: number, key: string) {
    const draftKey = cellId(productId, key);
    const draft = drafts[draftKey];
    if (draft === undefined) return;
    const value = toNum(draft);
    setDrafts((d) => {
      const next = { ...d };
      delete next[draftKey];
      return next;
    });
    await onCommit(productId, key, value);
  }

  const allProductIds = rows.map((r) => r.product.id);

  return (
    <RowGlowScroll focusStorageKey={focusStorageKey}>
      <table className="ae-table" style={{ minWidth: 720 }}>
        <thead>
          <tr>
            <th>SKU</th>
            <th>Product</th>
            {columns.map((c) => (
              <th key={c.key}>{c.label}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {[...groups.entries()].map(([category, groupRows]) => {
            const hasPending =
              !!pending && groupRows.some((row) => pending[row.product.id]);
            const isExpanded = hasPending || !!expandedOverride[category];
            const isCollapsed = !isExpanded;
            return (
              <Fragment key={category}>
                <tr key={`${category}-header`}>
                  <td colSpan={columns.length + 2} style={{ padding: 0 }}>
                    <button
                      type="button"
                      onClick={() =>
                        setExpandedOverride((e) => ({
                          ...e,
                          [category]: !isExpanded,
                        }))
                      }
                      aria-expanded={!isCollapsed}
                      aria-controls={groupRows
                        .map((row) => `ae-stockgrid-row-${row.product.id}`)
                        .join(" ")}
                      aria-disabled={hasPending || undefined}
                      title={
                        hasPending
                          ? `${category} has unsaved edits, so it stays expanded`
                          : isCollapsed
                            ? `Expand ${category}`
                            : `Collapse ${category}`
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
                      {category}
                    </button>
                  </td>
                </tr>
                {groupRows.map((row) => (
                  <tr
                    key={row.product.id}
                    id={`ae-stockgrid-row-${row.product.id}`}
                    data-row-id={row.product.id}
                    className={
                      isCollapsed ? "ae-cat-row ae-row-collapsed" : "ae-cat-row"
                    }
                    style={
                      row.isFlagged
                        ? { background: colors.warningBg }
                        : undefined
                    }
                  >
                    <td style={skuCellStyle}>{row.product.sku ?? "—"}</td>
                    <td style={nameCellStyle}>{row.product.name}</td>
                    {columns.map((col) => {
                      const draftKey = cellId(row.product.id, col.key);
                      const raw = row.entry[col.key];
                      const displayValue =
                        drafts[draftKey] ??
                        (raw === null || raw === undefined ? "" : String(raw));
                      if (!col.editable || readOnly) {
                        return (
                          <td
                            key={col.key}
                            style={col.editable ? undefined : lockedStyle}
                          >
                            {raw === null || raw === undefined
                              ? "—"
                              : Number(raw).toLocaleString()}
                          </td>
                        );
                      }
                      return (
                        <td key={col.key}>
                          <NumberCellInput
                            data-cell={draftKey}
                            value={displayValue}
                            onChange={(v) =>
                              setDrafts((d) => ({ ...d, [draftKey]: v }))
                            }
                            onBlur={() => commit(row.product.id, col.key)}
                            onKeyDown={(e) =>
                              handleKeyDown(
                                e,
                                row.product.id,
                                col.key,
                                allProductIds,
                              )
                            }
                            style={inputStyle}
                          />
                        </td>
                      );
                    })}
                  </tr>
                ))}
                <tr key={`${category}-subtotal`} style={subtotalRowStyle}>
                  <td colSpan={2}>Subtotal - {category}</td>
                  {columns.map((col) => (
                    <td key={col.key}>
                      {groupRows
                        .reduce((sum, r) => sum + toNum(r.entry[col.key]), 0)
                        .toLocaleString()}
                    </td>
                  ))}
                </tr>
              </Fragment>
            );
          })}
          <tr style={grandTotalRowStyle}>
            <td colSpan={2}>GRAND TOTAL</td>
            {columns.map((col) => (
              <td key={col.key}>
                {rows
                  .reduce((sum, r) => sum + toNum(r.entry[col.key]), 0)
                  .toLocaleString()}
              </td>
            ))}
          </tr>
        </tbody>
      </table>
    </RowGlowScroll>
  );
}

// Product names never wrap - a long name (e.g. "Distilled Cane Vinegar
// White") just widens this one column instead of breaking to a second line
// and inflating every row's height. Border/padding/alignment defaults
// otherwise come from the shared .ae-table CSS (index.css).
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
const lockedStyle: CSSProperties = {
  background: colors.paperAlt,
  color: "var(--ae-num-text)",
};
// Border/radius/focus ring come from the shared .ae-input class - only the
// sizing that's specific to this dense grid layout is overridden here.
const inputStyle: CSSProperties = { width: 64, textAlign: "center" };
// A real <button>, not just a styled <td> (the old categoryRowStyle) - the
// whole category bar needs to be a single clickable/keyboard-focusable
// target for the expand/collapse arrow, spanning every column exactly like
// the row it replaces did.
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
