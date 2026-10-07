import {
  Fragment,
  memo,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent,
} from "react";
import type { ChangeLogEntry, Product } from "../types";
import { colors } from "../theme";
import { RowGlowScroll } from "./RowGlowScroll";
import { NumberCellInput } from "./ui";
import { ChevronIcon } from "./icons";
import { listChangeLog } from "../api/changeLog";
import {
  formatGridNumber,
  formatPercentOfTotal,
  isUnusualJump,
  isValidStockValue,
  ZERO_DASH,
} from "../utils/gridFormat";

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
  /**
   * Adds an arrow to this column's header that shows/hides these input columns
   * directly to its right. They are real, saved fields that belong to this
   * column only (Delivery (Out) is the total of its five Delivery columns) -
   * nothing else reads them. Ignored on read-only grids, where only the
   * parent column's total is shown.
   */
  subColumns?: { key: string; label: string }[];
}

// Grid lines for the sub-columns, header cell through the totals row (see
// .ae-extra-col in index.css); the first one also gets the left edge.
function extraCellClass(i: number): string {
  return i === 0 ? "ae-extra-col ae-extra-col--first" : "ae-extra-col";
}

// Names typed into the sub-columns' header inputs are a per-browser label
// only (the saved data is keyed by the column, not by its name).
const NAMES_STORAGE_KEY = "ala-eh-grid-subcolumn-names";
function loadNames(): Record<string, string> {
  try {
    const raw = localStorage.getItem(NAMES_STORAGE_KEY);
    return raw ? (JSON.parse(raw) as Record<string, string>) : {};
  } catch {
    return {};
  }
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
  /**
   * Column key to show a "% of total" companion column after - each row's
   * share of that column's grand total. Typically the sheet's bottom-line
   * figure (Remaining Stock), since a share of an intermediate movement
   * column rarely means anything. Omit for no percentage column.
   */
  percentOfTotalKey?: string;
  /**
   * Stages a batch of cell edits as one step - what Quick Fill commits (fill
   * a value down a column, zero a whole category). Without it the Quick Fill
   * controls are hidden, since there'd be nowhere to send the result.
   * Separate from `onCommit` so the page can fold the whole batch into a
   * single undo step rather than one per cell.
   */
  onCommitMany?: (
    edits: { productId: number; key: string; value: number }[],
  ) => void;
  /**
   * This cell's last-SAVED value, as opposed to `row.entry[key]`, which
   * already has any staged edit overlaid. Needed to tell a large edit apart
   * from a large saved figure for the unusual-jump warning, and to give
   * Quick Fill the baseline that decides whether a filled cell is really a
   * change. Omit on grids with nothing staged.
   */
  getSavedValue?: (productId: number, key: string) => number | undefined;
  /**
   * The change_log table name backing this grid ("daily_online_stock",
   * "daily_offline_stock", ...). Set it to turn on cell history: hovering a
   * saved cell looks up who last changed it and when. Rows that have never
   * been saved carry no database id and so have no history to show.
   */
  historyTable?: string;
}

/// Rows the grid renders are the API's, which carry the database row id for
/// anything already saved - `OnlineEntry`/`OfflineEntry` don't declare it
/// (the client has never needed it), so it's read structurally here. Absent
/// means "never saved", which is exactly when there's no history either.
function recordIdOf(row: GridRow): number | undefined {
  const id = (row.entry as { id?: unknown }).id;
  return typeof id === "number" ? id : undefined;
}

function toNum(v: unknown): number {
  if (v === null || v === undefined || v === "") return 0;
  return Number(v);
}

// Height of the single sticky header row (`.ae-table th`'s own `top: 0` /
// `position: sticky`) - where a category row's own sticky offset starts, so
// it sits right under the header rather than overlapping it.
const HEADER_ROW_HEIGHT = 26;

function focusCell(productId: number, key: string) {
  const el = document.querySelector<HTMLInputElement>(
    `[data-cell="${productId}:${key}"]`,
  );
  el?.focus();
  el?.select();
}

/// Per-record change-log cache, shared by every cell in the table. One
/// database row holds the whole product/date/shift entry, so all of that
/// row's cells answer from a single request - hovering across a row costs
/// one fetch, not one per column. Lives at module scope so it also survives
/// re-renders and remounts within a session; entries are small and the grid
/// only ever holds one sheet's worth.
const historyCache = new Map<string, Promise<ChangeLogEntry[]>>();

function fetchRecordHistory(table: string, recordId: number): Promise<ChangeLogEntry[]> {
  const key = `${table}:${recordId}`;
  const hit = historyCache.get(key);
  if (hit) return hit;
  const req = listChangeLog({ tableName: table, recordId }).catch(() => {
    // A failed lookup shouldn't be cached as a permanent "no history" -
    // drop it so the next hover retries.
    historyCache.delete(key);
    return [] as ChangeLogEntry[];
  });
  historyCache.set(key, req);
  return req;
}

/// change_log stores whole-row snapshots, so "who last touched THIS cell" is
/// the most recent entry whose value for this column actually moved.
function lastChangeForColumn(entries: ChangeLogEntry[], colKey: string): ChangeLogEntry | undefined {
  return entries.find((e) => {
    const oldV = (e.oldValue as Record<string, unknown> | null)?.[colKey];
    const newV = (e.newValue as Record<string, unknown> | null)?.[colKey];
    // A CREATE has no previous row; it counts as setting every non-zero cell.
    if (e.action === "CREATE") return newV !== undefined && Number(newV) !== 0;
    return oldV !== undefined && newV !== undefined && Number(oldV) !== Number(newV);
  });
}

function describeWhen(iso: string): string {
  const then = new Date(iso).getTime();
  if (!Number.isFinite(then)) return "";
  const mins = Math.round((Date.now() - then) / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  return new Date(iso).toLocaleDateString();
}

/// Hover tooltip for one cell's provenance. Deliberately title-attribute
/// shaped rather than a positioned popover: it reuses the browser's own
/// tooltip, so it can't be clipped by the table's scroll container and costs
/// no layout work in a grid of several hundred cells. The lookup is lazy -
/// nothing is requested until a cell is actually hovered.
function useCellHistoryTitle(
  table: string | undefined,
  recordId: number | undefined,
  colKey: string,
  hovered: boolean,
): string | undefined {
  const [title, setTitle] = useState<string | undefined>(undefined);

  useEffect(() => {
    if (!hovered || !table || recordId === undefined) return;
    let cancelled = false;
    fetchRecordHistory(table, recordId).then((entries) => {
      if (cancelled) return;
      const hit = lastChangeForColumn(entries, colKey);
      if (!hit) {
        setTitle("No recorded changes to this cell");
        return;
      }
      const who = hit.changedBy?.name ?? "Unknown user";
      setTitle(`Last changed by ${who} - ${describeWhen(hit.changedAt)}`);
    });
    return () => {
      cancelled = true;
    };
  }, [hovered, table, recordId, colKey]);

  return title;
}

interface DraftCellProps {
  productId: number;
  colKey: string;
  /** The row's own saved/staged value - what the input shows when no draft is in progress. */
  raw: unknown;
  /** True while this cell holds a staged, not-yet-saved edit - shown green. */
  edited: boolean;
  onCommit: (
    productId: number,
    key: string,
    value: number,
  ) => void | Promise<void>;
  onKeyDown: (
    e: KeyboardEvent<HTMLInputElement>,
    productId: number,
    key: string,
  ) => void;
  /** Last-saved value, for the unusual-jump warning. */
  savedValue?: number;
  /** change_log table for this grid, if cell history is on. */
  historyTable?: string;
  /** This row's database id, absent until the row has been saved once. */
  recordId?: number;
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
  edited,
  onCommit,
  onKeyDown,
  savedValue,
  historyTable,
  recordId,
}: DraftCellProps) {
  const [draft, setDraft] = useState<string | undefined>(undefined);
  const [hovered, setHovered] = useState(false);
  const displayValue =
    draft ?? (raw === null || raw === undefined ? "" : String(raw));

  // Rejected outright: stock figures are counts of physical product, so a
  // negative (or non-numeric) reading is never valid and the server would
  // refuse it on save anyway. Flagged at the keystroke rather than after a
  // round trip, and the cell refuses to commit while it holds one.
  const invalid = draft !== undefined && !isValidStockValue(draft);
  // Allowed, but called out: a value an order of magnitude off what was last
  // saved is usually a typo (a stray digit), and occasionally a real
  // restock - so this warns and never blocks.
  const suspicious =
    !invalid &&
    draft !== undefined &&
    savedValue !== undefined &&
    isUnusualJump(toNum(draft), savedValue);

  const historyTitle = useCellHistoryTitle(historyTable, recordId, colKey, hovered);
  const title = invalid
    ? "Stock can't be negative - enter 0 or more"
    : suspicious
      ? `Unusually large change from the saved value of ${savedValue?.toLocaleString()} - check this is right`
      : historyTitle;

  async function commit() {
    if (draft === undefined) return;
    // Keep an invalid draft on screen so the encoder sees what they typed
    // and can correct it, rather than silently snapping back to the old
    // value as if the keystrokes never happened.
    if (!isValidStockValue(draft)) return;
    const value = toNum(draft);
    setDraft(undefined);
    await onCommit(productId, colKey, value);
  }

  return (
    <NumberCellInput
      data-cell={`${productId}:${colKey}`}
      className={
        [
          edited ? "ae-input-cell--edited" : "",
          invalid ? "ae-input-cell--invalid" : "",
          suspicious ? "ae-input-cell--suspicious" : "",
        ]
          .filter(Boolean)
          .join(" ") || undefined
      }
      value={displayValue}
      onChange={setDraft}
      onBlur={commit}
      onKeyDown={(e) => onKeyDown(e, productId, colKey)}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      title={title}
      aria-invalid={invalid || undefined}
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
  percentOfTotalKey,
  onCommitMany,
  getSavedValue,
  historyTable,
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
  // Whether the sub-columns after the `subColumns` column (Delivery (Out))
  // are showing. Not persisted - it's a view toggle, like the category
  // collapse above.
  const [extrasOpen, setExtrasOpen] = useState(false);
  const [extraNames, setExtraNames] =
    useState<Record<string, string>>(loadNames);

  const groups = new Map<string, GridRow[]>();
  for (const row of rows) {
    const list = groups.get(row.product.category) ?? [];
    list.push(row);
    groups.set(row.product.category, list);
  }

  // Grand total of the percentage column, which every row's share is taken
  // against. Computed once per render rather than per row.
  const percentTotal = useMemo(
    () =>
      percentOfTotalKey
        ? rows.reduce((sum, r) => sum + toNum(r.entry[percentOfTotalKey]), 0)
        : 0,
    [rows, percentOfTotalKey],
  );
  const showPercent = !!percentOfTotalKey;

  // Quick Fill needs somewhere to send a batch and a baseline to compare
  // each filled cell against, so it's only offered when the page wired both.
  const canQuickFill = !readOnly && !!onCommitMany && !!getSavedValue;

  /// Expand/collapse every category at once. Categories holding a pending
  /// edit are force-expanded regardless (see `pending`), so "collapse all"
  /// genuinely means "collapse everything that is safe to hide".
  function setAllExpanded(expanded: boolean) {
    const next: Record<string, boolean> = {};
    for (const category of groups.keys()) next[category] = expanded;
    setExpandedOverride(next);
  }
  const anyExpanded = [...groups.keys()].some((c) => expandedOverride[c]);

  /// Quick Fill - copy the topmost row's value in this column down every
  /// other row currently in the grid. "Currently in the grid" matters: the
  /// page filters `rows` before handing them over, so a fill respects an
  /// active search or category filter instead of silently touching rows the
  /// encoder can't see.
  function fillDown(colKey: string) {
    if (!onCommitMany || rows.length < 2) return;
    const value = toNum(rows[0].entry[colKey]);
    const edits = rows
      .slice(1)
      .map((r) => ({ productId: r.product.id, key: colKey, value }));
    onCommitMany(edits);
  }

  /// Quick Fill - set every editable cell in one category to zero, for a
  /// product line that simply didn't move this shift.
  function zeroCategory(category: string) {
    if (!onCommitMany) return;
    const groupRows = groups.get(category) ?? [];
    const keys = columns
      .filter((c) => c.editable)
      .flatMap((c) => [
        c.key,
        ...(showExtras && c.subColumns ? c.subColumns.map((sc) => sc.key) : []),
      ]);
    const edits = groupRows.flatMap((r) =>
      keys.map((key) => ({ productId: r.product.id, key, value: 0 })),
    );
    onCommitMany(edits);
  }

  const showExtras = extrasOpen && !readOnly;
  const extraCount = showExtras
    ? columns.reduce((n, c) => n + (c.subColumns?.length ?? 0), 0)
    : 0;

  const allProductIds = rows.map((r) => r.product.id);
  // Arrow-key navigation order: the sub-columns sit right after the
  // column that owns them, so they're stepped through like any other cell.
  const editableColKeys = columns.flatMap((c) => [
    ...(c.editable ? [c.key] : []),
    ...(showExtras && c.subColumns ? c.subColumns.map((sc) => sc.key) : []),
  ]);

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
    <>
      {groups.size > 0 && (
        <div className="ae-grid-tools no-print">
          <button
            type="button"
            className="ae-grid-tool-btn"
            onClick={() => setAllExpanded(!anyExpanded)}
            title={
              anyExpanded
                ? "Collapse every category"
                : "Expand every category"
            }
          >
            <span
              style={{
                display: "inline-flex",
                transform: anyExpanded ? "none" : "rotate(-90deg)",
                transition: "transform 260ms cubic-bezier(0.22, 1, 0.36, 1)",
              }}
            >
              <ChevronIcon />
            </span>
            {anyExpanded ? "Collapse all" : "Expand all"}
          </button>
        </div>
      )}
      <RowGlowScroll focusStorageKey={focusStorageKey}>
      <table className="ae-table ae-table--sticky-id" style={{ minWidth: 720 }}>
        <thead>
          <tr>
            <th className="ae-sticky-sku">SKU</th>
            <th className="ae-sticky-name">Product</th>
            {columns.map((c) => (
              <Fragment key={c.key}>
                <th
                  style={{
                    ...(c.tone ? columnToneStyle[c.tone] : undefined),
                    // The arrow straddles this cell's right border, so this
                    // header sits above its neighbour (which would otherwise
                    // paint over the half of the arrow that overhangs it) and
                    // keeps its label clear of the arrow's inner half.
                    ...(c.subColumns && !readOnly
                      ? { zIndex: 2, paddingRight: 14 }
                      : undefined),
                  }}
                >
                  {c.label}
                  {canQuickFill && c.editable && rows.length > 1 && (
                    <button
                      type="button"
                      className="ae-fill-down-btn no-print"
                      onClick={() => fillDown(c.key)}
                      title={`Fill the top row's ${c.label} down every row below it`}
                      aria-label={`Fill ${c.label} down`}
                    >
                      &darr;
                    </button>
                  )}
                  {c.subColumns && !readOnly && (
                    <button
                      type="button"
                      onClick={() => setExtrasOpen((o) => !o)}
                      aria-expanded={extrasOpen}
                      title={
                        extrasOpen
                          ? `Hide the ${c.label} columns`
                          : `Show the ${c.label} columns`
                      }
                      aria-label={
                        extrasOpen
                          ? `Hide the columns behind ${c.label}`
                          : `Show the columns behind ${c.label}`
                      }
                      style={headerArrowStyle}
                    >
                      <span
                        style={{
                          display: "inline-flex",
                          // Chevron points down by default: right when
                          // closed (expands sideways), left when open.
                          transform: extrasOpen
                            ? "rotate(90deg)"
                            : "rotate(-90deg)",
                          transition:
                            "transform 260ms cubic-bezier(0.22, 1, 0.36, 1)",
                        }}
                      >
                        <ChevronIcon />
                      </span>
                    </button>
                  )}
                </th>
                {showExtras &&
                  c.subColumns?.map((sc, i) => (
                    <th
                      key={sc.key}
                      className={extraCellClass(i)}
                      aria-label={sc.label}
                      style={{
                        ...(c.tone ? columnToneStyle[c.tone] : undefined),
                        minWidth: 96,
                        padding: 0,
                      }}
                    >
                      {/* Full-cell text input: the header cell's own padding
                          is dropped so the input fills it edge to edge. */}
                      <input
                        type="text"
                        className="ae-extra-head-input"
                        value={extraNames[sc.key] ?? ""}
                        onChange={(e) => {
                          const value = e.target.value;
                          setExtraNames((n) => {
                            const next = { ...n, [sc.key]: value };
                            try {
                              localStorage.setItem(
                                NAMES_STORAGE_KEY,
                                JSON.stringify(next),
                              );
                            } catch {
                              // label only - fine to lose
                            }
                            return next;
                          });
                        }}
                        placeholder={sc.label}
                        aria-label={`${sc.label} name`}
                        spellCheck={false}
                        autoComplete="off"
                      />
                    </th>
                  ))}
                {showPercent && c.key === percentOfTotalKey && (
                  <th
                    className="ae-pct-col"
                    title={`Each row's share of the ${c.label} grand total`}
                  >
                    % of total
                  </th>
                )}
              </Fragment>
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
                    colSpan={columns.length + 2 + extraCount + (showPercent ? 1 : 0)}
                    style={{
                      padding: 0,
                      position: "sticky",
                      top: HEADER_ROW_HEIGHT,
                      // Above the sticky SKU/Product columns (z-index 2): the
                      // bar spans the full width, so when it pins under the
                      // header the identity cells scrolling beneath it have
                      // to pass behind, not through.
                      zIndex: 3,
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
                      className="ae-cat-toggle"
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
                      {canQuickFill && (
                        // Nested inside the toggle button is invalid HTML, so
                        // this is a sibling span acting as the click target -
                        // it stops propagation so zeroing a category doesn't
                        // also collapse it.
                        <span
                          role="button"
                          tabIndex={0}
                          className="ae-cat-zero no-print"
                          title={`Set every editable cell in ${category} to zero`}
                          onClick={(e) => {
                            e.stopPropagation();
                            zeroCategory(category);
                          }}
                          onKeyDown={(e) => {
                            if (e.key !== "Enter" && e.key !== " ") return;
                            e.stopPropagation();
                            e.preventDefault();
                            zeroCategory(category);
                          }}
                        >
                          Zero all
                        </span>
                      )}
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
                    <td className="ae-cell-sku ae-sticky-sku">
                      {row.product.sku ?? ZERO_DASH}
                    </td>
                    <td className="ae-cell-name ae-sticky-name">
                      {row.product.name}
                    </td>
                    {columns.map((col) => {
                      const raw = row.entry[col.key];
                      const pct = showPercent &&
                        col.key === percentOfTotalKey && (
                          <td key={`${col.key}-pct`} className="ae-pct-col">
                            {formatPercentOfTotal(toNum(raw), percentTotal)}
                          </td>
                        );
                      const formatted = formatGridNumber(raw);
                      const cell =
                        !col.editable || readOnly ? (
                          <td
                            key={col.key}
                            className={formatted.isZero ? "ae-num-zero" : undefined}
                            style={{
                              ...(col.editable ? undefined : lockedStyle),
                              ...tintFor(col),
                            }}
                          >
                            {formatted.text}
                          </td>
                        ) : (
                          <td key={col.key} style={tintFor(col)}>
                            <DraftCell
                              productId={row.product.id}
                              colKey={col.key}
                              raw={raw}
                              edited={
                                pending?.[row.product.id]?.[col.key] !==
                                undefined
                              }
                              onCommit={commitCell}
                              onKeyDown={handleKeyDown}
                              savedValue={getSavedValue?.(row.product.id, col.key)}
                              historyTable={historyTable}
                              recordId={recordIdOf(row)}
                            />
                          </td>
                        );
                      if (!showExtras || !col.subColumns)
                        return pct ? (
                          <Fragment key={col.key}>
                            {cell}
                            {pct}
                          </Fragment>
                        ) : (
                          cell
                        );
                      return (
                        <Fragment key={col.key}>
                          {cell}
                          {col.subColumns.map((sc, i) => (
                            <td
                              key={sc.key}
                              className={extraCellClass(i)}
                              style={tintFor(col)}
                            >
                              <DraftCell
                                productId={row.product.id}
                                colKey={sc.key}
                                raw={row.entry[sc.key]}
                                edited={
                                  pending?.[row.product.id]?.[sc.key] !==
                                  undefined
                                }
                                onCommit={commitCell}
                                onKeyDown={handleKeyDown}
                                savedValue={getSavedValue?.(row.product.id, sc.key)}
                                historyTable={historyTable}
                                recordId={recordIdOf(row)}
                              />
                            </td>
                          ))}
                          {pct}
                        </Fragment>
                      );
                    })}
                  </tr>
                ))}
                {/* Deliberately NOT marked .ae-cat-row, so it stays visible
                    when the category is collapsed (collapsing hides only the
                    product rows) - a collapsed sheet still reads as a list of
                    per-category totals rather than going blank. */}
                <tr key={`${category}-subtotal`} className="ae-row-subtotal">
                  <td colSpan={2} className="ae-sticky-subtotal">
                    Subtotal - {category}
                  </td>
                  {columns.map((col) => {
                    const sum = groupRows.reduce(
                      (acc, r) => acc + toNum(r.entry[col.key]),
                      0,
                    );
                    return (
                      <Fragment key={col.key}>
                        <td style={tintFor(col)}>{sum.toLocaleString()}</td>
                        {showExtras &&
                          col.subColumns?.map((sc, i) => (
                            <td
                              key={sc.key}
                              className={extraCellClass(i)}
                              style={tintFor(col)}
                            >
                              {groupRows
                                .reduce(
                                  (acc, r) => acc + toNum(r.entry[sc.key]),
                                  0,
                                )
                                .toLocaleString()}
                            </td>
                          ))}
                        {showPercent && col.key === percentOfTotalKey && (
                          <td className="ae-pct-col">
                            {formatPercentOfTotal(sum, percentTotal)}
                          </td>
                        )}
                      </Fragment>
                    );
                  })}
                </tr>
              </Fragment>
            );
          })}
          <tr className="ae-row-grand">
            <td colSpan={2} className="ae-sticky-subtotal">
              GRAND TOTAL
            </td>
            {columns.map((col) => (
              <Fragment key={col.key}>
                <td style={tintFor(col)}>
                  {rows
                    .reduce((sum, r) => sum + toNum(r.entry[col.key]), 0)
                    .toLocaleString()}
                </td>
                {showExtras &&
                  col.subColumns?.map((sc, i) => (
                    <td
                      key={sc.key}
                      className={extraCellClass(i)}
                      style={tintFor(col)}
                    >
                      {rows
                        .reduce((sum, r) => sum + toNum(r.entry[sc.key]), 0)
                        .toLocaleString()}
                    </td>
                  ))}
                {showPercent && col.key === percentOfTotalKey && (
                  // Always 100% by definition - shown so the column has a
                  // footer and doesn't read as a missing cell.
                  <td className="ae-pct-col">
                    {percentTotal ? "100.0%" : ZERO_DASH}
                  </td>
                )}
              </Fragment>
            ))}
          </tr>
        </tbody>
      </table>
      </RowGlowScroll>
    </>
  );
}

const lockedStyle: CSSProperties = {
  backgroundColor: colors.paperAlt,
  color: "var(--ae-num-text)",
};
// Border/radius/focus ring come from the shared .ae-input class - only the
// sizing that's specific to this dense grid layout is overridden here.
const inputStyle: CSSProperties = { width: 64, textAlign: "right" };
// The expand arrow: a small dark tab centered on the Delivery header's right
// border (half inside the cell, half over the next one). The header cell is
// position: sticky, so it is the containing block for this absolute button.
const headerArrowStyle: CSSProperties = {
  position: "absolute",
  top: "50%",
  right: -9,
  transform: "translateY(-50%)",
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  width: 18,
  height: 18,
  padding: 0,
  border: "none",
  borderRadius: 6,
  background: colors.black,
  color: colors.yellow,
  cursor: "pointer",
  lineHeight: 0,
};
