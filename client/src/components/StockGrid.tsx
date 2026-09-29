import {
  Fragment,
  memo,
  useCallback,
  useLayoutEffect,
  useRef,
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
  /**
   * Header color coding for stock movement columns: "in" (stocks in), "out"
   * (stocks out) and "delivery" (delivery / fulfillment out). Purely visual -
   * see columnToneStyle below; unused by CSV/PDF/Excel exports.
   */
  tone?: "in" | "out" | "delivery";
}

// Header fills for the color-coded columns. Pastel fills on purpose, with the
// near-black brand ink as the label color, so the header text stays readable
// in both light and dark mode (these do not flip with the theme).
const TONE_COLOR: Record<NonNullable<GridColumn["tone"]>, string> = {
  in: "#9DB0FF", // light blue / periwinkle
  out: "#F59A9A", // light red
  delivery: "#F7A8CC", // pink
};
export const columnToneStyle: Record<
  NonNullable<GridColumn["tone"]>,
  CSSProperties
> = {
  in: { background: TONE_COLOR.in, color: "#0C0C0C" },
  out: { background: TONE_COLOR.out, color: "#0C0C0C" },
  delivery: { background: TONE_COLOR.delivery, color: "#0C0C0C" },
};

// Body-cell tint for the same columns. Drawn as a translucent background-IMAGE
// layer (not background-color), so the table's row-hover fill - which is a
// background-color - keeps showing through underneath and the hover effect is
// unchanged.
export const columnTintStyle: Record<
  NonNullable<GridColumn["tone"]>,
  CSSProperties
> = {
  in: tintLayer(TONE_COLOR.in),
  out: tintLayer(TONE_COLOR.out),
  delivery: tintLayer(TONE_COLOR.delivery),
};
function tintLayer(color: string): CSSProperties {
  const tint = `color-mix(in srgb, ${color} 22%, transparent)`;
  return { backgroundImage: `linear-gradient(${tint}, ${tint})` };
}
function tintFor(col: GridColumn): CSSProperties | undefined {
  return col.tone ? columnTintStyle[col.tone] : undefined;
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

// Height of the single sticky header row (`.ae-table th`'s own `top: 0` /
// `position: sticky`) - where a category row's own sticky offset starts, so
// it sits right under the header rather than overlapping it.
const HEADER_ROW_HEIGHT = 29;

function focusCell(productId: number, key: string) {
  const el = document.querySelector<HTMLInputElement>(
    `[data-cell="${productId}:${key}"]`,
  );
  el?.focus();
  el?.select();
}

interface DraftCellProps {
  productId: number;
  colKey: string;
  /** The row's own saved/staged value - what the input shows when no draft is in progress. */
  raw: unknown;
  onCommit: (productId: number, key: string, value: number) => void | Promise<void>;
  onKeyDown: (
    e: KeyboardEvent<HTMLInputElement>,
    productId: number,
    key: string,
  ) => void;
}

/**
 * One editable grid cell. The in-progress text (`draft`) lives here rather
 * than in StockGrid, so a keystroke re-renders just this cell instead of every
 * row, cell and subtotal in the table. Behavior is unchanged: the draft shows
 * while typing, is cleared and committed on blur, and falls back to `raw`.
 * `memo` keeps sibling cells from re-rendering when the grid itself does
 * (props are all primitives or stable callbacks).
 */
const DraftCell = memo(function DraftCell({
  productId,
  colKey,
  raw,
  onCommit,
  onKeyDown,
}: DraftCellProps) {
  const [draft, setDraft] = useState<string | undefined>(undefined);
  const displayValue =
    draft ?? (raw === null || raw === undefined ? "" : String(raw));

  async function commit() {
    if (draft === undefined) return;
    const value = toNum(draft);
    setDraft(undefined);
    await onCommit(productId, colKey, value);
  }

  return (
    <NumberCellInput
      data-cell={`${productId}:${colKey}`}
      value={displayValue}
      onChange={setDraft}
      onBlur={commit}
      onKeyDown={(e) => onKeyDown(e, productId, colKey)}
      style={inputStyle}
    />
  );
});

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

  const allProductIds = rows.map((r) => r.product.id);
  const editableColKeys = columns.filter((c) => c.editable).map((c) => c.key);

  // The page hands over a fresh `onCommit` (and this render a fresh id/column
  // list) every render. Reading them through refs keeps the callbacks passed
  // to the memoized cells below referentially stable, so a re-render of the
  // grid doesn't re-render every cell.
  const onCommitRef = useRef(onCommit);
  const navRef = useRef({ rowIds: allProductIds, colKeys: editableColKeys });
  useLayoutEffect(() => {
    onCommitRef.current = onCommit;
    navRef.current = { rowIds: allProductIds, colKeys: editableColKeys };
  });

  const commitCell = useCallback(
    (productId: number, key: string, value: number) =>
      onCommitRef.current(productId, key, value),
    [],
  );

  const handleKeyDown = useCallback(
    (e: KeyboardEvent<HTMLInputElement>, productId: number, key: string) => {
      const { rowIds, colKeys } = navRef.current;
      const rowIndex = rowIds.indexOf(productId);
      const colIndex = colKeys.indexOf(key);
      if (e.key === "Enter" || e.key === "ArrowDown") {
        e.preventDefault();
        const nextId = rowIds[rowIndex + 1];
        if (nextId !== undefined) focusCell(nextId, key);
        e.currentTarget.blur();
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        const prevId = rowIds[rowIndex - 1];
        if (prevId !== undefined) focusCell(prevId, key);
      } else if (e.key === "ArrowRight") {
        e.preventDefault();
        const nextKey = colKeys[colIndex + 1];
        if (nextKey !== undefined) focusCell(productId, nextKey);
      } else if (e.key === "ArrowLeft") {
        e.preventDefault();
        const prevKey = colKeys[colIndex - 1];
        if (prevKey !== undefined) focusCell(productId, prevKey);
      }
    },
    [],
  );

  return (
    <RowGlowScroll focusStorageKey={focusStorageKey}>
      <table className="ae-table" style={{ minWidth: 720 }}>
        <thead>
          <tr>
            <th>SKU</th>
            <th>Product</th>
            {columns.map((c) => (
              <th
                key={c.key}
                style={c.tone ? columnToneStyle[c.tone] : undefined}
              >
                {c.label}
              </th>
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
                  {/* Sticky Scroll (CSS-only, no JS): pinned right under the
                      header while this category's rows scroll by; once they
                      scroll past, the next category's own row reaches the
                      same top offset and, being later in the DOM (painted
                      after), simply covers this one - the standard sticky-
                      header handoff. This grid's column count is
                      fixed per page, so only the vertical stick is needed
                      here. */}
                  <td
                    colSpan={columns.length + 2}
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
                      const raw = row.entry[col.key];
                      if (!col.editable || readOnly) {
                        return (
                          <td
                            key={col.key}
                            style={{
                              ...(col.editable ? undefined : lockedStyle),
                              ...tintFor(col),
                            }}
                          >
                            {raw === null || raw === undefined
                              ? "—"
                              : Number(raw).toLocaleString()}
                          </td>
                        );
                      }
                      return (
                        <td key={col.key} style={tintFor(col)}>
                          <DraftCell
                            productId={row.product.id}
                            colKey={col.key}
                            raw={raw}
                            onCommit={commitCell}
                            onKeyDown={handleKeyDown}
                          />
                        </td>
                      );
                    })}
                  </tr>
                ))}
                <tr key={`${category}-subtotal`} style={subtotalRowStyle}>
                  <td colSpan={2}>Subtotal - {category}</td>
                  {columns.map((col) => (
                    <td key={col.key} style={tintFor(col)}>
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
              <td key={col.key} style={tintFor(col)}>
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
  backgroundColor: colors.paperAlt,
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
