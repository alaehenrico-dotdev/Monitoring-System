import { useEffect, useRef } from "react";

/**
 * Ctrl+S (Cmd+S on a Mac) saves the sheet.
 *
 * `claim` says whether this sheet owns the shortcut. On a sheet that can be
 * edited it always does, even when there is nothing to save: the browser's own
 * "Save page as..." is never what someone typing into a stock sheet meant, and
 * letting it open on a keystroke made for the Save button is just a surprise.
 * `onSave` decides whether anything actually happens (it does nothing with no
 * changes). On a read-only sheet the shortcut is left to the browser.
 */
export function useSaveShortcut(onSave: () => void, claim: boolean) {
  const saveRef = useRef(onSave);
  useEffect(() => {
    saveRef.current = onSave;
  });

  useEffect(() => {
    if (!claim) return;
    function onKeyDown(e: KeyboardEvent) {
      if (!(e.ctrlKey || e.metaKey) || e.shiftKey || e.altKey || e.key.toLowerCase() !== "s") return;
      e.preventDefault();
      saveRef.current();
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [claim]);
}
