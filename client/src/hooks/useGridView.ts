import { useEffect, useMemo } from "react";
import type { GridRow } from "../components/StockGrid";
import type { PendingByProduct } from "./usePendingEntryChanges";
import { useSessionState } from "./useSessionState";

/// The row filters that sit alongside the existing search box and category
/// dropdown on the entry grids. Both narrow what's already loaded - neither
/// refetches - so they compose with search and category rather than
/// replacing them.
export type RowFilter = "all" | "changed" | "negative";

export const ROW_FILTER_LABELS: Record<RowFilter, string> = {
  all: "All rows",
  changed: "Only changed",
  negative: "Only negative",
};

/// A row counts as "negative" when any numeric cell in it is below zero.
/// Negative stock is never a real reading - it means an entry is wrong
/// somewhere upstream - so this is the "show me what needs fixing" filter
/// rather than a report of a particular column.
export function hasNegativeValue(row: GridRow): boolean {
  return Object.values(row.entry).some(
    (v) => typeof v === "number" && v < 0,
  );
}

export function matchesRowFilter(
  row: GridRow,
  filter: RowFilter,
  pending: PendingByProduct,
): boolean {
  if (filter === "changed") return pending[row.product.id] !== undefined;
  if (filter === "negative") return hasNegativeValue(row);
  return true;
}

/// Keeps the chosen filter in session storage alongside the page's other
/// in-progress view state, so switching page and coming back doesn't silently
/// drop the encoder back to the full list.
export function useRowFilter(storageKey: string) {
  return useSessionState<RowFilter>(storageKey, "all");
}

/// Ctrl+Z / Ctrl+Shift+Z (and Ctrl+Y) over staged edits. Ignored while the
/// focus is in a text field, where the browser's own undo of the in-progress
/// keystrokes is what the user means - the grid's undo is for *committed*
/// cell edits, not the characters being typed into one.
export function useUndoRedoKeys(
  undo: () => void,
  redo: () => void,
  enabled: boolean,
) {
  useEffect(() => {
    if (!enabled) return;
    function onKeyDown(e: KeyboardEvent) {
      if (!e.ctrlKey && !e.metaKey) return;
      const key = e.key.toLowerCase();
      if (key !== "z" && key !== "y") return;

      const el = document.activeElement;
      const typing =
        el instanceof HTMLInputElement ||
        el instanceof HTMLTextAreaElement ||
        (el instanceof HTMLElement && el.isContentEditable);
      if (typing) return;

      e.preventDefault();
      if (key === "y" || e.shiftKey) redo();
      else undo();
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [undo, redo, enabled]);
}

/// Last-saved value lookup for one sheet, as StockGrid's `getSavedValue`.
/// Built as a Map once per rows change rather than scanning the row list on
/// every cell render - the grid asks for this per editable cell, so a linear
/// find would be O(rows x columns) on every single render.
export function useSavedValueLookup(rows: GridRow[] | null) {
  return useMemo(() => {
    const byProduct = new Map<number, Record<string, unknown>>();
    for (const r of rows ?? []) byProduct.set(r.product.id, r.entry);
    return (productId: number, key: string): number | undefined => {
      const raw = byProduct.get(productId)?.[key];
      if (raw === null || raw === undefined || raw === "") return undefined;
      const n = Number(raw);
      return Number.isFinite(n) ? n : undefined;
    };
  }, [rows]);
}
