/**
 * Undo/redo history of the staged-but-unsaved edits, kept in sessionStorage so
 * it survives switching to another page and back (the page unmounts, and its
 * React state with it). Same lifetime as the staged edits themselves: it lasts
 * for the browser tab, and is dropped on log out, Data Reset, and whenever the
 * edits it could put back have been saved or discarded.
 *
 * One entry per sheet (page + date + shift), so each sheet keeps its own
 * history and one sheet's undo can never reach another's edits. Best effort,
 * like every other storage write in the entry pages: blocked or full storage
 * just means history does not survive navigation.
 */

const HISTORY_PREFIX = "ala-eh-history:";

/// Snapshots are whole staged sets, so this bounds the stored size well under
/// the ~5 MB sessionStorage quota even on a long sheet. In memory the pages
/// still keep up to 100 steps.
const PERSISTED_STEPS = 40;

interface Stored<T> {
  past: T[];
  future: T[];
}

export function loadHistory<T>(sheetKey: string | undefined): Stored<T> {
  const empty: Stored<T> = { past: [], future: [] };
  if (!sheetKey) return empty;
  try {
    const raw = sessionStorage.getItem(HISTORY_PREFIX + sheetKey);
    if (!raw) return empty;
    const v = JSON.parse(raw) as Partial<Stored<T>>;
    return {
      past: Array.isArray(v.past) ? v.past : [],
      future: Array.isArray(v.future) ? v.future : [],
    };
  } catch {
    return empty;
  }
}

export function saveHistory<T>(sheetKey: string | undefined, past: T[], future: T[]): void {
  if (!sheetKey) return;
  try {
    if (past.length === 0 && future.length === 0) {
      sessionStorage.removeItem(HISTORY_PREFIX + sheetKey);
      return;
    }
    sessionStorage.setItem(
      HISTORY_PREFIX + sheetKey,
      JSON.stringify({ past: past.slice(-PERSISTED_STEPS), future: future.slice(0, PERSISTED_STEPS) }),
    );
  } catch {
    // Quota or blocked storage - the history just won't survive navigation.
  }
}

export function clearAllHistory(): void {
  try {
    const keys: string[] = [];
    for (let i = 0; i < sessionStorage.length; i++) {
      const k = sessionStorage.key(i);
      if (k && k.startsWith(HISTORY_PREFIX)) keys.push(k);
    }
    keys.forEach((k) => sessionStorage.removeItem(k));
  } catch {
    // best effort
  }
}
