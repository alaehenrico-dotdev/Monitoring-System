import { useEffect, useMemo, useState } from "react";
import type { GridRow } from "../components/StockGrid";
import { ENTRY_PREFIX, MANUAL_COUNT_PREFIX, RECEIPT_DRAFT_PREFIX } from "../utils/unsavedWork";

/// productId -> { columnKey -> staged value }
export type PendingByProduct = Record<number, Record<string, number>>;

/// sessionStorage (not localStorage - this is in-progress work for the
/// current browser session, not a durable per-viewer preference like zoom)
/// so navigating to another page and back - or closing/reopening the Save
/// preview - doesn't lose it, while closing the tab does, same as any other
/// unsaved form data would. Best-effort: a private window or blocked site
/// data just means pending edits don't survive navigation, not that editing
/// itself breaks.
function loadPending(storageKey: string | undefined): PendingByProduct {
  if (!storageKey) return {};
  try {
    const raw = sessionStorage.getItem(storageKey);
    return raw ? (JSON.parse(raw) as PendingByProduct) : {};
  } catch {
    return {};
  }
}

/**
 * Section 3.1 - "Save" / "Preview" on the Online/Offline Entry grids: a cell
 * edit used to hit the save endpoint the instant you tabbed/clicked away,
 * with no way to review a batch of changes before they went live. This holds
 * edits locally (keyed by product) until the page's own Save button flushes
 * them, and gives Preview something concrete (old value -> new value, per
 * field) to show first.
 *
 * Deliberately shallow: it doesn't know about the save endpoint, mirroring
 * to the other table, or the calculated columns (Online/Offline/Remaining
 * Stock) - those still only update once a change is actually saved, exactly
 * like a CSV import already behaves. Recomputing them locally would mean
 * duplicating the server's own stock-math formulas just for an in-progress
 * preview.
 *
 * `storageKey` (typically namespaced by page + date + shift, since pending
 * edits only make sense against one specific grid) persists the pending set
 * to sessionStorage as it changes, and reloads it whenever `storageKey`
 * itself changes - not just on first mount. That's what makes an in-progress
 * edit survive switching to a different page and back (the whole page
 * unmounts and remounts, losing ordinary component state) and, on the same
 * page, switching date/shift away and back (no remount, but the caller's own
 * effect for that already clears local rows/state - this hook re-derives its
 * own state from storage on the same schedule instead of being told to
 * clear). Omit `storageKey` to get the old, in-memory-only behavior.
 */
export function usePendingEntryChanges(
  rows: GridRow[] | null,
  storageKey?: string,
  /**
   * Recomputes this row's derived/locked columns (Offline or Online Stocks,
   * Remaining Stock, and - for Offline - Delivery (Out)) from a staged-but-
   * not-yet-saved change, so the live grid reflects e.g. a changed Opening
   * Stock immediately instead of only once Save round-trips to the server
   * and back. Given the last-saved entry plus this product's own pending
   * diff (not the already-merged display entry - same shape
   * computeNewDeliveryOut/validateImportRow already expect); returns just
   * the fields to override on top of the merged entry. Omit entirely for a
   * read-only table (Daily Report) with nothing to stage in the first
   * place, or if the caller doesn't have these columns at all.
   */
  recompute?: (entry: Record<string, unknown>, changes: Record<string, number>) => Record<string, unknown>,
) {
  const [pending, setPending] = useState<PendingByProduct>(() => loadPending(storageKey));

  // Re-derives pending from storage only when the key itself changes (a
  // different date/shift/page) - the persistence effect below is what reacts
  // to every actual edit.
  useEffect(() => {
    setPending(loadPending(storageKey));
  }, [storageKey]);

  useEffect(() => {
    if (!storageKey) return;
    try {
      // No trailing empty `{}` entries left behind once every edit in a
      // given date/shift is saved or discarded.
      if (Object.keys(pending).length === 0) sessionStorage.removeItem(storageKey);
      else sessionStorage.setItem(storageKey, JSON.stringify(pending));
    } catch {
      // Best effort, per the note above - editing still works either way.
    }
  }, [pending, storageKey]);

  // What the grid should actually render - the last-saved rows with any
  // staged-but-not-yet-saved edits overlaid on top, so typing a value shows
  // up immediately without a round trip. `recompute` (if given) then
  // re-derives the locked/computed columns from that same staged diff, so
  // e.g. a changed Opening Stock is reflected in Offline/Online Stocks and
  // Remaining Stock right away too - otherwise those would keep showing
  // last-saved figures until the edit is actually Saved.
  const displayRows = useMemo(() => {
    if (!rows || Object.keys(pending).length === 0) return rows;
    return rows.map((r) => {
      const changes = pending[r.product.id];
      if (!changes) return r;
      const merged = { ...r.entry, ...changes };
      const entry = recompute ? { ...merged, ...recompute(r.entry, changes) } : merged;
      return { ...r, entry, isSaved: false };
    });
  }, [rows, pending, recompute]);

  /// Stages one cell's edit. Editing a cell back to its last-saved value
  /// removes it from the pending set entirely, rather than leaving a
  /// no-op change sitting in Preview/Save.
  function stage(productId: number, key: string, value: number, savedValue: number) {
    setPending((prev) => {
      const productPending = { ...(prev[productId] ?? {}) };
      if (value === savedValue) delete productPending[key];
      else productPending[key] = value;

      const next = { ...prev };
      if (Object.keys(productPending).length === 0) delete next[productId];
      else next[productId] = productPending;
      return next;
    });
  }

  /// Drops one product's pending changes once they've been saved (or the
  /// user discards them) - not the whole set, so a partial-failure Save
  /// (some products saved, some didn't) can clear just the successful ones.
  function clear(productId: number) {
    setPending((prev) => {
      if (!(productId in prev)) return prev;
      const next = { ...prev };
      delete next[productId];
      return next;
    });
  }

  function clearAll() {
    setPending({});
  }

  return { pending, displayRows, stage, clear, clearAll, pendingCount: Object.keys(pending).length };
}

/// Called by Data Reset (DataResetPage.tsx) right after the server-side wipe
/// succeeds - session storage is a client-side cache the reset has no way to
/// reach, and a staged-but-unsaved edit left over from before the reset
/// would otherwise get submitted against data that no longer has the same
/// baseline (or doesn't exist at all) once the reset finishes. Covers every
/// page that stages edits this way: this hook's own pending-value keys
/// (Online/Offline Entry) and every page's focus-position key, plus Manual
/// Count's separate pending-value prefix (utils/unsavedWork.ts, which this
/// must stay in sync with - hence importing its prefixes rather than
/// re-typing them here).
export function clearAllPendingEntryState() {
  try {
    const keys: string[] = [];
    for (let i = 0; i < sessionStorage.length; i++) {
      const k = sessionStorage.key(i);
      if (k && (k.startsWith(ENTRY_PREFIX) || k.startsWith(MANUAL_COUNT_PREFIX) || k.startsWith(RECEIPT_DRAFT_PREFIX) || k.startsWith("ala-eh-focus:"))) keys.push(k);
    }
    keys.forEach((k) => sessionStorage.removeItem(k));
  } catch {
    // best-effort, same as the rest of this file
  }
}

export interface PendingChangeDetail {
  productId: number;
  name: string;
  category: string;
  label: string;
  oldValue: number;
  newValue: number;
}

/// Expands the raw pending map into display-ready rows for the Preview
/// modal - product name/category and the column's human label, resolved
/// against the last-saved rows (not the pending-overlaid displayRows above,
/// which would show the new value as its own "old" value).
export function describePendingChanges(
  rows: GridRow[] | null,
  pending: PendingByProduct,
  columns: { key: string; label: string }[],
): PendingChangeDetail[] {
  if (!rows) return [];
  const details: PendingChangeDetail[] = [];
  for (const [productIdStr, changes] of Object.entries(pending)) {
    const productId = Number(productIdStr);
    const row = rows.find((r) => r.product.id === productId);
    if (!row) continue;
    for (const [key, newValue] of Object.entries(changes)) {
      details.push({
        productId,
        name: row.product.name,
        category: row.product.category,
        label: columns.find((c) => c.key === key)?.label ?? key,
        oldValue: Number(row.entry[key] ?? 0),
        newValue,
      });
    }
  }
  return details;
}
