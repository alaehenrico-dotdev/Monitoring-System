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
import type { Product } from "../types";
import { colors } from "../theme";
import { RowGlowScroll } from "./RowGlowScroll";
import { NumberCellInput } from "./ui";
import { ChevronIcon } from "./icons";
import { ColumnHeaderMenu, type ColumnMenuTarget } from "./ColumnHeaderMenu";
import {
  CategoryColorMenu,
  type CategoryMenuTarget,
} from "./CategoryColorMenu";
import { ContextMenu, type ContextMenuItem } from "./ContextMenu";
import {
  CellHistoryPopover,
  type CellHistoryTarget,
} from "./CellHistoryPopover";
import { extraColumnKey, parseExtraColumnKey } from "../hooks/useExtraColumns";
import {
  inkFor,
  useCategoryColors,
  useColumnColors,
} from "../hooks/useColumnColors";
import {
  describeWhen,
  fetchCellHistory,
  lastChange,
} from "../utils/cellHistory";
import { consumeQuickJump, subscribeQuickJump } from "../utils/quickJumpTarget";
import {
  describePasteResult,
  describePasteSkips,
  MAX_PASTE_CELLS,
  parseClipboardGrid,
  planPaste,
  type PasteTargetColumn,
} from "../utils/gridPaste";
import { showToast } from "./Toast";
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
}

// Shared empty list, so a column with no added columns doesn't hand a fresh
// array to every cell on every render.
const NO_EXTRAS: number[] = [];

// Grid lines for the sub-columns, header cell through the totals row (see
// .ae-extra-col in index.css); the first one also gets the left edge.
function extraCellClass(i: number): string {
  return i === 0 ? "ae-extra-col ae-extra-col--first" : "ae-extra-col";
}

// Names typed into an added column's header input are a per-browser label
// only (the saved data is keyed by the column and slot, not by its name) -
// which is why this is localStorage and not part of the entry at all.
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
function tintFor(col: GridColumn, custom?: string): CSSProperties | undefined {
  if (custom) return tintLayer(custom);
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
  /**
   * Expand/collapse every category from outside the grid (the page's toolbar
   * icon). Each new `id` is one command; a command that was already issued
   * before this grid mounted (e.g. it was re-keyed by a date/shift change) is
   * not replayed.
   */
  expandAllCommand?: { expanded: boolean; id: number } | null;
  /** Reports whether any category is currently expanded, so the page's
   *  expand/collapse icon can show the action a click will perform. */
  onAnyExpandedChange?: (anyExpanded: boolean) => void;
  /**
   * Extra input columns added at runtime from an editable column header's
   * right-click menu, as `main column key -> slot numbers` (see
   * hooks/useExtraColumns.ts). They render directly after the column that owns
   * them, carry its tone, and are staged like any other cell; that main column
   * then shows the read-only sum of them, which is what every total, subtotal,
   * Remaining Stock and % of total keeps reading. Omit for a grid that doesn't
   * offer them (the Daily Report and every other read-only table).
   */
  extraColumns?: Record<string, number[]>;
  /** Wire both to turn the header menu on; without them no menu is offered
   *  and headers keep the browser's own context menu. */
  onAddExtraColumns?: (mainKey: string, count: number) => void;
  onRemoveExtraColumns?: (mainKey: string, slots: number[]) => void;
  /**
   * Namespaces the header colors picked from the same right-click menu
   * (hooks/useColumnColors.ts) - "online" and "offline" share column keys,
   * so without it a color picked on one sheet would paint the other.
   */
  colorScope?: string;
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
    fetchCellHistory(table, recordId, colKey).then((entries) => {
      if (cancelled) return;
      const hit = lastChange(entries);
      if (!hit) {
        setTitle("No recorded changes to this cell");
        return;
      }
      setTitle(
        `Last changed by ${hit.who ?? "Unknown user"} - ${describeWhen(hit.changedAt)}`,
      );
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
  /** Opens the cell menu. Omitted on a grid that doesn't offer one, which
   *  leaves the browser's own context menu in place. */
  onCellMenu?: (productId: number, key: string, x: number, y: number) => void;
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
  onCellMenu,
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

  const historyTitle = useCellHistoryTitle(
    historyTable,
    recordId,
    colKey,
    hovered,
  );
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
      onKeyDown={(e) => {
        // Shift+F10 and the dedicated ContextMenu key are the platform
        // conventions for "open the context menu for what's focused" - the
        // same pair the column headers already answer to.
        if (
          onCellMenu &&
          (e.key === "ContextMenu" || (e.key === "F10" && e.shiftKey))
        ) {
          e.preventDefault();
          const r = e.currentTarget.getBoundingClientRect();
          onCellMenu(productId, colKey, r.left, r.bottom);
          return;
        }
        onKeyDown(e, productId, colKey);
      }}
      onContextMenu={
        onCellMenu
          ? (e) => {
              e.preventDefault();
              onCellMenu(productId, colKey, e.clientX, e.clientY);
            }
          : undefined
      }
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
  expandAllCommand,
  onAnyExpandedChange,
  extraColumns,
  onAddExtraColumns,
  onRemoveExtraColumns,
  colorScope = "grid",
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
  const [extraNames, setExtraNames] =
    useState<Record<string, string>>(loadNames);
  // Which header's right-click menu is open, if any (null = none). Held here
  // rather than per-header so only one can ever be open at a time.
  const [menu, setMenu] = useState<ColumnMenuTarget | null>(null);
  const closeMenu = useCallback(() => setMenu(null), []);
  // The cell right-click menu, and the history popover it can open. Held
  // here rather than per cell so only one of each can ever be open, and so a
  // memoized DraftCell doesn't have to carry any of this state.
  const [cellMenu, setCellMenu] = useState<{
    productId: number;
    colKey: string;
    x: number;
    y: number;
  } | null>(null);
  const closeCellMenu = useCallback(() => setCellMenu(null), []);
  const [history, setHistory] = useState<CellHistoryTarget | null>(null);
  const closeHistory = useCallback(() => setHistory(null), []);

  // The added columns (hooks/useExtraColumns.ts) belonging to one column.
  // Never undefined, so callers can map over it without a guard.
  const addedOf = (key: string): number[] => extraColumns?.[key] ?? NO_EXTRAS;
  // The menu is only offered when the page wired both handlers - a read-only
  // grid (Daily Report) leaves the browser's own context menu alone.
  const canAddColumns =
    !readOnly && !!onAddExtraColumns && !!onRemoveExtraColumns;
  // Header colors picked from the right-click menu (per browser, see
  // hooks/useColumnColors.ts). A pick overrides the column's `tone`; resetting
  // it falls back to the tone, or to no color at all for an untoned column.
  const { getColor, setColor } = useColumnColors(colorScope);
  const colorOf = (col: GridColumn): string | undefined =>
    getColor(col.key) ?? (col.tone ? TONE_COLOR[col.tone] : undefined);
  const headerStyleFor = (col: GridColumn): CSSProperties | undefined => {
    const c = colorOf(col);
    return c ? { background: c, color: inkFor(c) } : undefined;
  };
  const tint = (col: GridColumn) => tintFor(col, getColor(col.key));
  // Category header rows get the same treatment from their own right-click
  // menu: a pick replaces the default bar color for that category.
  const { getColor: getCategoryColor, setColor: setCategoryColor } =
    useCategoryColors(colorScope);
  const [catMenu, setCatMenu] = useState<CategoryMenuTarget | null>(null);
  const closeCatMenu = useCallback(() => setCatMenu(null), []);
  const categoryStyleFor = (category: string): CSSProperties | undefined => {
    const c = getCategoryColor(category);
    return c ? { background: c, color: inkFor(c) } : undefined;
  };
  /// A main column holding added columns is their read-only total, so its own
  /// cell stops being an input - the sum is what Remaining Stock, the
  /// subtotals and the % column all go on reading.
  const isEditable = (col: GridColumn) =>
    !!col.editable && addedOf(col.key).length === 0;

  /// The added columns that render directly after `col` (header right-click
  /// menu), in display order - which is also the arrow-key navigation order.
  /// Declared before use by the totals rows further down.
  function trailingKeys(col: GridColumn): string[] {
    return addedOf(col.key).map((slot) => extraColumnKey(col.key, slot));
  }

  function renameExtraColumn(key: string, value: string) {
    setExtraNames((n) => {
      const next = { ...n, [key]: value };
      try {
        localStorage.setItem(NAMES_STORAGE_KEY, JSON.stringify(next));
      } catch {
        // label only - fine to lose
      }
      return next;
    });
  }

  function openMenu(col: GridColumn, x: number, y: number) {
    setMenu({
      mainKey: col.key,
      label: col.label,
      x,
      y,
      added: addedOf(col.key),
      color: colorOf(col),
      customColor: getColor(col.key) !== undefined,
    });
  }

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
  const appliedCommandId = useRef(expandAllCommand?.id);
  useEffect(() => {
    if (!expandAllCommand || expandAllCommand.id === appliedCommandId.current)
      return;
    appliedCommandId.current = expandAllCommand.id;
    setAllExpanded(expandAllCommand.expanded);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [expandAllCommand]);
  useEffect(() => {
    onAnyExpandedChange?.(anyExpanded);
  }, [anyExpanded, onAnyExpandedChange]);

  /// Ctrl+K quick jump (utils/quickJumpTarget.ts): the palette parks a
  /// product id, and whichever grid actually has that product claims it.
  /// Nothing here is a new highlight - expanding the category reuses the
  /// same `expandedOverride` map the category bars write, and focusing the
  /// row's first editable cell is what RowGlowScroll already watches to pin
  /// its focus ring, so a jumped-to row ends up marked exactly like one
  /// clicked into by hand.
  ///
  /// `rows` is in the dep list, not just the subscription: a request made
  /// while the page was still fetching has no row to land on yet, and must
  /// be retried once the rows arrive.
  const rowsRef = useRef(rows);
  // Written in a layout effect, never during render (same rule the
  // onCommitRef/navRef pair below follows), and before the jump effect runs.
  useLayoutEffect(() => {
    rowsRef.current = rows;
  });
  useEffect(() => {
    function tryJump() {
      const current = rowsRef.current;
      const productId = consumeQuickJump((id) =>
        current.some((r) => r.product.id === id),
      );
      if (productId === null) return;
      const row = current.find((r) => r.product.id === productId);
      if (!row) return;

      // Expanded before the scroll, not after: a collapsed category's rows
      // are hidden, and scrolling to a hidden row lands nowhere.
      setExpandedOverride((prev) =>
        prev[row.product.category]
          ? prev
          : { ...prev, [row.product.category]: true },
      );

      // One frame later, so the row has been laid out at its real position.
      requestAnimationFrame(() => {
        const el = document.getElementById(`ae-stockgrid-row-${productId}`);
        el?.scrollIntoView({ block: "center", behavior: "smooth" });
        // Focusing the row's first editable cell pins RowGlowScroll's ring
        // (its onFocus handler) and leaves the encoder ready to type. Read
        // off the DOM rather than the column list: a read-only grid simply
        // has no input to find, and the scroll alone is the whole gesture
        // there.
        const input = el?.querySelector<HTMLInputElement>("input[data-cell]");
        input?.focus();
        input?.select();
      });
    }
    tryJump();
    return subscribeQuickJump(tryJump);
  }, [rows]);

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
      .flatMap((c) => [...(isEditable(c) ? [c.key] : []), ...trailingKeys(c)]);
    const edits = groupRows.flatMap((r) =>
      keys.map((key) => ({ productId: r.product.id, key, value: 0 })),
    );
    onCommitMany(edits);
  }

  const extraCount = columns.reduce((n, c) => n + addedOf(c.key).length, 0);

  const allProductIds = rows.map((r) => r.product.id);
  // Arrow-key navigation order: the sub-columns sit right after the
  // column that owns them, so they're stepped through like any other cell.
  const editableColKeys = columns.flatMap((c) => [
    ...(isEditable(c) ? [c.key] : []),
    ...trailingKeys(c),
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

  /**
   * Ctrl+V of a spreadsheet selection, anchored at whichever cell has focus
   * and flowing right across editable columns and down across visible rows.
   *
   * Listens on the <table> rather than each input: the paste event bubbles
   * from the focused cell, so one handler covers every cell (including extra
   * columns) and costs nothing per cell to attach.
   *
   * A 1x1 paste is deliberately left alone - no preventDefault - so pasting a
   * single figure into a single cell still just fills the input and commits
   * on blur, exactly as it always has, including the invalid/suspicious
   * styling DraftCell applies while the draft is in progress.
   */
  function handlePaste(e: React.ClipboardEvent<HTMLTableElement>) {
    if (readOnly || !onCommitMany) return;
    const focused = document.activeElement;
    const cell =
      focused instanceof HTMLElement ? focused.getAttribute("data-cell") : null;
    if (!cell) return;
    // Column keys can themselves contain the separator (extra columns are
    // "stockIn__x1"), so only the first colon splits off the product id.
    const colon = cell.indexOf(":");
    if (colon === -1) return;
    const productId = Number(cell.slice(0, colon));
    const key = cell.slice(colon + 1);
    if (!Number.isFinite(productId)) return;

    const text = e.clipboardData.getData("text/plain");
    const grid = parseClipboardGrid(text);
    if (grid.length === 0) return;
    if (grid.length === 1 && grid[0].length === 1) return; // today's behavior

    e.preventDefault();

    // Display order, so a pasted block flows across extra columns exactly as
    // it looks on screen. A main column holding extras is reported as
    // non-editable *with* the reason, since its cell is the read-only sum.
    const targetColumns: PasteTargetColumn[] = columns.flatMap((c) => {
      const extras = addedOf(c.key);
      return [
        {
          key: c.key,
          label: c.label,
          editable: isEditable(c),
          hasExtraColumns: !!c.editable && extras.length > 0,
        },
        ...extras.map((slot) => ({
          key: extraColumnKey(c.key, slot),
          label: `${c.label} +${slot}`,
          editable: true,
        })),
      ];
    });

    const plan = planPaste(
      grid,
      { productId, key },
      rows.map((r) => ({ productId: r.product.id, name: r.product.name })),
      targetColumns,
      (id, k) => {
        const row = rows.find((r) => r.product.id === id);
        return row ? toNum(row.entry[k]) : undefined;
      },
    );

    if (plan.tooLarge) {
      showToast(
        `That paste is ${plan.tooLarge.cells.toLocaleString()} cells - the limit is ${MAX_PASTE_CELLS}. Nothing was pasted.`,
        "error",
      );
      return;
    }

    if (plan.edits.length === 0 && plan.skipped.length === 0) return;

    // One call, so the whole paste is a single Ctrl+Z - stageMany takes a
    // snapshot per call, not per cell.
    if (plan.edits.length > 0) onCommitMany(plan.edits);

    // Body stays a one-line summary; the per-cell reasons hang off its own
    // tooltip, so a 40-skip paste explains itself without filling the screen.
    // Carried on the toast itself rather than written onto the shared toast
    // stack, so it disappears with the message it belongs to.
    showToast(
      describePasteResult(plan),
      plan.edits.length === 0 ? "warning" : "success",
      undefined,
      describePasteSkips(plan) || undefined,
    );
  }

  // Stable identity (the cells are memoized), so opening a menu never costs
  // a re-render of the other several hundred cells.
  const openCellMenu = useCallback(
    (productId: number, key: string, x: number, y: number) =>
      setCellMenu({ productId, colKey: key, x, y }),
    [],
  );

  /// "Sweet A - Stocks In", the cell menu's heading.
  function cellMenuTitle(productId: number, colKey: string): string {
    const row = rows.find((r) => r.product.id === productId);
    const label =
      columns.find((c) => c.key === colKey)?.label ??
      (() => {
        const parsed = parseExtraColumnKey(colKey);
        const main = parsed && columns.find((c) => c.key === parsed.mainKey);
        return main ? `${main.label} +${parsed!.slot}` : colKey;
      })();
    return `${row?.product.name ?? "Row"} - ${label}`;
  }

  /**
   * The editable cell's right-click menu.
   *
   * "View history" is always offered - an empty history is itself an answer,
   * and hiding the item on rows that happen to have none would make the
   * menu's shape depend on data the user can't see. "Set to 0" and "Copy
   * value down" only appear when the page wired a batch handler, since
   * without one there is nowhere to send the result.
   */
  function cellMenuItems(target: {
    productId: number;
    colKey: string;
  }): ContextMenuItem[] {
    const { productId, colKey } = target;
    const row = rows.find((r) => r.product.id === productId);
    const current = row ? toNum(row.entry[colKey]) : 0;

    const items: ContextMenuItem[] = [
      {
        id: "history",
        label: "View history",
        run: () => {
          if (!historyTable || !row) return;
          setHistory({
            x: cellMenu?.x ?? 0,
            y: cellMenu?.y ?? 0,
            table: historyTable,
            recordId: recordIdOf(row),
            colKey,
            columnLabel: cellMenuTitle(productId, colKey),
            productName: row.product.name,
          });
        },
        disabled: !historyTable,
        title: historyTable
          ? undefined
          : "This table doesn't keep a change history",
      },
    ];

    if (onCommitMany) {
      items.push({
        id: "zero",
        label: "Set to 0",
        disabled: current === 0,
        title: current === 0 ? "Already 0" : undefined,
        run: () => onCommitMany([{ productId, key: colKey, value: 0 }]),
      });
      items.push({
        id: "fill-down",
        label: "Copy value down",
        // Copies to every row BELOW this one in the current (filtered) view,
        // which is the narrower, more predictable sibling of the header's
        // own fill-down-from-the-top arrow.
        disabled:
          rows.findIndex((r) => r.product.id === productId) >= rows.length - 1,
        title: "Copy this value into every row below it",
        run: () => {
          const from = rows.findIndex((r) => r.product.id === productId);
          if (from === -1) return;
          onCommitMany(
            rows
              .slice(from + 1)
              .map((r) => ({
                productId: r.product.id,
                key: colKey,
                value: current,
              })),
          );
        },
      });
    }

    return items;
  }

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
      <RowGlowScroll focusStorageKey={focusStorageKey}>
        <table
          className="ae-table ae-table--sticky-id"
          style={{ minWidth: 720 }}
          onPaste={handlePaste}
        >
          <thead>
            <tr>
              <th className="ae-sticky-sku">SKU</th>
              <th className="ae-sticky-name">Product</th>
              {columns.map((c) => (
                <Fragment key={c.key}>
                  <th
                    tabIndex={canAddColumns && c.editable ? 0 : undefined}
                    title={
                      canAddColumns && c.editable
                        ? `Right-click to add or remove extra ${c.label} columns, or change its color`
                        : undefined
                    }
                    onContextMenu={
                      canAddColumns && c.editable
                        ? (e) => {
                            e.preventDefault();
                            openMenu(c, e.clientX, e.clientY);
                          }
                        : undefined
                    }
                    onKeyDown={
                      canAddColumns && c.editable
                        ? (e) => {
                            // Shift+F10 and the dedicated ContextMenu key are
                            // the platform conventions for "open the context
                            // menu for what's focused".
                            if (
                              e.key !== "ContextMenu" &&
                              !(e.key === "F10" && e.shiftKey)
                            )
                              return;
                            e.preventDefault();
                            const r = e.currentTarget.getBoundingClientRect();
                            openMenu(c, r.left, r.bottom);
                          }
                        : undefined
                    }
                    style={headerStyleFor(c)}
                  >
                    {c.label}
                    {canQuickFill && isEditable(c) && rows.length > 1 && (
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
                  </th>
                  {addedOf(c.key).map((slot, i) => (
                    <th
                      key={extraColumnKey(c.key, slot)}
                      className={extraCellClass(i)}
                      style={{
                        ...headerStyleFor(c),
                        minWidth: 96,
                        // Dropped so the name input fills the cell edge to
                        // edge, same as the fixed Delivery headers it replaces.
                        padding: 0,
                      }}
                    >
                      <span className="ae-added-col-head">
                        {/* Nameable, the way the fixed Delivery columns this
                            replaced were - a per-browser label, so one shift
                            can call its added columns by route or customer
                            without that becoming saved data. */}
                        <input
                          type="text"
                          className="ae-extra-head-input"
                          value={extraNames[extraColumnKey(c.key, slot)] ?? ""}
                          onChange={(e) =>
                            renameExtraColumn(
                              extraColumnKey(c.key, slot),
                              e.target.value,
                            )
                          }
                          placeholder={`+${slot}`}
                          aria-label={`${c.label} +${slot} name`}
                          spellCheck={false}
                          autoComplete="off"
                        />
                        <button
                          type="button"
                          className="ae-added-col-del no-print"
                          onClick={() => onRemoveExtraColumns?.(c.key, [slot])}
                          title={`Delete this added ${c.label} column`}
                          aria-label={`Delete added ${c.label} column +${slot}`}
                        >
                          &times;
                        </button>
                      </span>
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
                      colSpan={
                        columns.length + 2 + extraCount + (showPercent ? 1 : 0)
                      }
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
                        style={categoryStyleFor(category)}
                        onContextMenu={(e) => {
                          e.preventDefault();
                          setCatMenu({
                            category,
                            x: e.clientX,
                            y: e.clientY,
                          });
                        }}
                      >
                        <span className="ae-cat-label">
                          <span
                            style={{
                              display: "inline-flex",
                              transform: isCollapsed
                                ? "rotate(-90deg)"
                                : "none",
                              transition:
                                "transform 260ms cubic-bezier(0.22, 1, 0.36, 1)",
                            }}
                          >
                            <ChevronIcon />
                          </span>
                          {category}
                        </span>
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
                        isCollapsed
                          ? "ae-cat-row ae-row-collapsed"
                          : "ae-cat-row"
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
                          !isEditable(col) || readOnly ? (
                            <td
                              key={col.key}
                              className={
                                formatted.isZero ? "ae-num-zero" : undefined
                              }
                              style={{
                                ...(isEditable(col) ? undefined : lockedStyle),
                                ...tint(col),
                              }}
                            >
                              {formatted.text}
                            </td>
                          ) : (
                            <td key={col.key} style={tint(col)}>
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
                                savedValue={getSavedValue?.(
                                  row.product.id,
                                  col.key,
                                )}
                                historyTable={historyTable}
                                recordId={recordIdOf(row)}
                                onCellMenu={openCellMenu}
                              />
                            </td>
                          );
                        const trailing = trailingKeys(col);
                        if (trailing.length === 0)
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
                            {trailing.map((key, i) => (
                              <td
                                key={key}
                                className={extraCellClass(i)}
                                style={tint(col)}
                              >
                                <DraftCell
                                  productId={row.product.id}
                                  colKey={key}
                                  raw={row.entry[key]}
                                  edited={
                                    pending?.[row.product.id]?.[key] !==
                                    undefined
                                  }
                                  onCommit={commitCell}
                                  onKeyDown={handleKeyDown}
                                  savedValue={getSavedValue?.(
                                    row.product.id,
                                    key,
                                  )}
                                  historyTable={historyTable}
                                  recordId={recordIdOf(row)}
                                  onCellMenu={openCellMenu}
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
                          <td style={tint(col)}>{sum.toLocaleString()}</td>
                          {trailingKeys(col).map((key, i) => (
                            <td
                              key={key}
                              className={extraCellClass(i)}
                              style={tint(col)}
                            >
                              {groupRows
                                .reduce(
                                  (acc, r) => acc + toNum(r.entry[key]),
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
                  <td style={tint(col)}>
                    {rows
                      .reduce((sum, r) => sum + toNum(r.entry[col.key]), 0)
                      .toLocaleString()}
                  </td>
                  {trailingKeys(col).map((key, i) => (
                    <td
                      key={key}
                      className={extraCellClass(i)}
                      style={tint(col)}
                    >
                      {rows
                        .reduce((sum, r) => sum + toNum(r.entry[key]), 0)
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
      {menu && onAddExtraColumns && onRemoveExtraColumns && (
        <ColumnHeaderMenu
          target={menu}
          onAdd={onAddExtraColumns}
          onRemove={onRemoveExtraColumns}
          onColorChange={setColor}
          onClose={closeMenu}
        />
      )}
      {catMenu && (
        <CategoryColorMenu
          target={catMenu}
          color={getCategoryColor(catMenu.category)}
          customColor={getCategoryColor(catMenu.category) !== undefined}
          onColorChange={setCategoryColor}
          onClose={closeCatMenu}
        />
      )}
      {cellMenu && (
        <ContextMenu
          anchor={{ x: cellMenu.x, y: cellMenu.y }}
          title={cellMenuTitle(cellMenu.productId, cellMenu.colKey)}
          ariaLabel={`${cellMenuTitle(cellMenu.productId, cellMenu.colKey)} cell options`}
          items={cellMenuItems(cellMenu)}
          onClose={closeCellMenu}
        />
      )}
      {history && (
        <CellHistoryPopover target={history} onClose={closeHistory} />
      )}
    </>
  );
}

const lockedStyle: CSSProperties = {
  backgroundColor: colors.paperAlt,
  color: "var(--ae-num-text)",
};
// Border/radius/focus ring come from the shared .ae-input class - only the
// sizing that's specific to this dense grid layout is overridden here.
const inputStyle: CSSProperties = { width: 64, textAlign: "center" };
