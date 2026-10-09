import {
  MAX_PASTE_CELLS,
  describePasteResult,
  describePasteSkips,
  parseClipboardGrid,
  planPaste,
} from "./gridPaste";

export type CountLoc = "ONLINE" | "OFFLINE";

export interface CountPasteEdit {
  loc: CountLoc;
  productId: number;
  value: number;
}

export interface CountPasteOutcome {
  edits: CountPasteEdit[];
  message: string;
  /// Per-cell skip reasons, for the toast's tooltip.
  detail?: string;
  variant: "success" | "warning" | "error";
}

const LABELS: Record<CountLoc, string> = { OFFLINE: "Offline Count", ONLINE: "Online Count" };

/**
 * Ctrl+V of a spreadsheet block into the Audit count columns, anchored at the
 * focused count cell and flowing right across the visible location columns
 * (in on-screen order) and down across the visible rows. Same rules as the
 * Online/Offline grids (gridPaste.ts): blanks leave a cell alone, bad cells
 * are skipped one by one, an oversized block is refused whole.
 *
 * Returns null for nothing to do or a single cell, which the caller leaves to
 * the browser so pasting one figure into one input behaves as it always has.
 */
export function planCountPaste(
  text: string,
  anchor: { loc: CountLoc; productId: number },
  rows: { productId: number; name: string }[],
  locations: CountLoc[],
  currentOf: (loc: CountLoc, productId: number) => number | undefined,
): CountPasteOutcome | null {
  const grid = parseClipboardGrid(text);
  if (grid.length === 0 || (grid.length === 1 && grid[0].length === 1)) return null;

  const plan = planPaste(
    grid,
    { productId: anchor.productId, key: anchor.loc },
    rows,
    locations.map((loc) => ({ key: loc, label: LABELS[loc], editable: true })),
    (id, key) => currentOf(key as CountLoc, id),
  );

  if (plan.tooLarge) {
    return {
      edits: [],
      message: `That paste is ${plan.tooLarge.cells.toLocaleString()} cells - the limit is ${MAX_PASTE_CELLS}. Nothing was pasted.`,
      variant: "error",
    };
  }
  if (plan.edits.length === 0 && plan.skipped.length === 0) return null;

  return {
    edits: plan.edits.map((e) => ({ loc: e.key as CountLoc, productId: e.productId, value: e.value })),
    message: describePasteResult(plan),
    detail: describePasteSkips(plan) || undefined,
    variant: plan.edits.length === 0 ? "warning" : "success",
  };
}
