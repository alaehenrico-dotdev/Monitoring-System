import { useCallback, useEffect, useLayoutEffect, useRef, useState, type MouseEvent } from "react";
import { showToast } from "../components/Toast";
import { dragTo, EMPTY_SELECTION, pressRow, selectedIds, type SelectionState } from "../utils/rowSelection";

/**
 * Excel-style multi-row selection for a table (see utils/rowSelection.ts for the
 * rules): press a row to select it, Shift+press for a range, Ctrl/Cmd+press to
 * add or remove one, or press and drag. Esc clears it, Ctrl+C copies it and
 * Delete clears it (when `onClear` is given) - never while typing in a field,
 * with text selected, or with a dialog open.
 *
 * `visibleIds` is the rows on screen in drawn order; a row that is collapsed or
 * filtered away drops out of the selection until it is back. The callbacks get
 * the selected ids in that order.
 */
export function useRowSelection({
  visibleIds,
  onCopy,
  onClear,
}: {
  visibleIds: readonly number[];
  onCopy: (ids: number[]) => void;
  onClear?: (ids: number[]) => void;
}) {
  const [selection, setSelection] = useState<SelectionState>(EMPTY_SELECTION);
  const dragging = useRef(false);
  const selected = selectedIds(selection, visibleIds);
  const selectedSet = new Set(selected);

  const clear = useCallback(() => setSelection(EMPTY_SELECTION), []);
  function press(e: MouseEvent, id: number) {
    if (e.button !== 0) return;
    dragging.current = true;
    const mods = { shift: e.shiftKey, toggle: e.ctrlKey || e.metaKey };
    setSelection((prev) => pressRow(prev, id, mods, visibleIds));
  }
  function enter(id: number) {
    if (dragging.current) setSelection((prev) => dragTo(prev, id));
  }

  // The latest ids and callbacks for the one document listener below, so it is
  // registered once instead of on every render.
  const latest = useRef({ selected, onCopy, onClear, clear });
  useLayoutEffect(() => {
    latest.current = { selected, onCopy, onClear, clear };
  });
  useEffect(() => {
    const up = () => {
      dragging.current = false;
    };
    function onKey(e: globalThis.KeyboardEvent) {
      const a = latest.current;
      if (a.selected.length === 0) return;
      const t = e.target as HTMLElement | null;
      if (t?.closest("input, textarea, select, [contenteditable=true]")) return;
      if (document.querySelector('[role="dialog"]')) return;
      if (e.key === "Escape") {
        a.clear();
      } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "c") {
        // A text selection the person made themselves keeps its own copy.
        if (window.getSelection()?.toString()) return;
        e.preventDefault();
        a.onCopy(a.selected);
      } else if (e.key === "Delete" && a.onClear) {
        e.preventDefault();
        a.onClear(a.selected);
      }
    }
    window.addEventListener("mouseup", up);
    document.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("mouseup", up);
      document.removeEventListener("keydown", onKey);
    };
  }, []);

  return { selected, selectedSet, press, enter, clear };
}

/// Puts tab-separated text on the clipboard (Excel pastes it as a grid) and says so.
export function copyRowsToClipboard(text: string, rowCount: number) {
  const write = navigator.clipboard?.writeText(text);
  if (!write) {
    showToast("Couldn't copy - the browser blocked clipboard access", "error");
    return;
  }
  write.then(
    () => showToast(`Copied ${rowCount} row${rowCount === 1 ? "" : "s"} - paste into Excel`, "success"),
    () => showToast("Couldn't copy - the browser blocked clipboard access", "error"),
  );
}
