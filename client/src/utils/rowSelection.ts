/**
 * Excel-style multi-row selection for the stock grids (see StockGrid.tsx).
 *
 * The selection is a set of earlier picks (`base`) plus one live range from an
 * anchor row to the row last clicked or dragged to (`anchor`..`end`). Keeping the
 * range separate is what lets Shift extend or shrink it from the same anchor,
 * and Ctrl add a new range without losing the old ones - exactly how a
 * spreadsheet behaves. Rows are identified by product id; ranges are taken over
 * the rows currently visible, in the order they are drawn.
 */
export interface SelectionState {
  base: ReadonlySet<number>;
  anchor: number | null;
  end: number | null;
}

export const EMPTY_SELECTION: SelectionState = { base: new Set(), anchor: null, end: null };

/// The ids from `a` to `b` inclusive, in display order (either way round).
/// A `b` of null is "no range"; an end that is not visible leaves no range.
export function rangeBetween(order: readonly number[], a: number | null, b: number | null): number[] {
  if (b === null) return [];
  const j = order.indexOf(b);
  if (j === -1) return [];
  const i = a === null ? -1 : order.indexOf(a);
  if (i === -1) return [b];
  return order.slice(Math.min(i, j), Math.max(i, j) + 1);
}

/// Every selected id that is currently visible, in display order. A row that was
/// collapsed away (or filtered out) drops out of the selection until it is back.
export function selectedIds(state: SelectionState, visible: readonly number[]): number[] {
  const live = new Set<number>(state.base);
  for (const id of rangeBetween(visible, state.anchor, state.end)) live.add(id);
  return visible.filter((id) => live.has(id));
}

export interface PressModifiers {
  /// Shift: extend the range from the anchor.
  shift: boolean;
  /// Ctrl (or Cmd): add to / remove from what is already selected.
  toggle: boolean;
}

/// A mouse press on a row.
export function pressRow(state: SelectionState, id: number, mods: PressModifiers, visible: readonly number[]): SelectionState {
  if (mods.shift) {
    // Plain Shift replaces everything with the one range; Ctrl+Shift adds the
    // range to the earlier picks.
    return { base: mods.toggle ? state.base : new Set(), anchor: state.anchor ?? id, end: id };
  }
  if (mods.toggle) {
    const current = selectedIds(state, visible);
    if (current.includes(id)) {
      // Clicking a selected row with Ctrl takes it out; the anchor moves here so
      // a following Shift+click ranges from this row.
      return { base: new Set(current.filter((x) => x !== id)), anchor: id, end: null };
    }
    return { base: new Set(current), anchor: id, end: id };
  }
  return { base: new Set(), anchor: id, end: id };
}

/// The mouse moved onto another row with the button still down: stretch the live range.
export function dragTo(state: SelectionState, id: number): SelectionState {
  if (state.anchor === null || state.end === id) return state;
  return { ...state, end: id };
}

/// Tab-separated text, the form a spreadsheet pastes as a grid. Tabs and line
/// breaks inside a value would break the shape, so they become spaces.
export function toTsv(header: readonly string[], rows: readonly (readonly string[])[]): string {
  const clean = (s: string) => s.replace(/[\t\r\n]+/g, " ");
  return [header, ...rows].map((r) => r.map(clean).join("\t")).join("\n");
}
