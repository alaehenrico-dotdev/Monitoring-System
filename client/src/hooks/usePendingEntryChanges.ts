import { useEffect, useMemo, useState } from "react";
import type { GridRow } from "../components/StockGrid";
import { ENTRY_PREFIX, MANUAL_COUNT_PREFIX } from "../utils/unsavedWork";
import { clearDraftBackups } from "../utils/draftBackup";
import { EXTRA_COLUMNS_PREFIX } from "./useExtraColumns";

/// productId -> { columnKey -> staged value }
export type PendingByProduct = Record<number, Record<string, number>>;

/// Same shape as PendingByProduct, but holding the last-saved (server) value
/// each staged edit was made against - what lets a later refresh tell "the
/// server still has what I started from" apart from "someone else changed it
/// while I was editing (or offline)".
export type BaselineByProduct = Record<number, Record<string, number>>;

/// What a single product's Save needs Undo to put back - captured by
/// handleSaveAll (OnlineEntryPage/OfflineEntryPage), replayed by
/// handleUndoLastSave. Manual count is tracked separately from `fields`
/// (rather than folded into the same Record<string, number> PendingByProduct
/// uses) because its own revert value can be `null` - the count didn't exist
/// before this save created it, so there's nothing numeric to restore it to.
export interface SaveRevert {
  fields: Record<string, number>;
  /// Absent entirely if this product's save didn't touch its manual count.
  manualCount?: number | null;
}
export type LastSavedBatch = Record<number, SaveRevert>;

/// Baselines live under their own prefix (not ENTRY_PREFIX) so
/// utils/unsavedWork.ts, which counts every ENTRY_PREFIX key as a page's
/// staged edits, never mistakes one for a second pending set.
/// One undoable point in time: both maps together, since staging a cell
/// writes to each and undoing one without the other would leave an edit with
/// no baseline (or a baseline with no edit) behind.
interface Snapshot {
  pending: PendingByProduct;
  baselines: BaselineByProduct;
}

/// Bounded so a long editing session can't grow the stack without limit.
const HISTORY_LIMIT = 100;

const BASELINE_PREFIX = "ala-eh-baseline:";
const baselineKeyFor = (storageKey: string | undefined) =>
  storageKey ? BASELINE_PREFIX + storageKey : undefined;

export interface PendingConflict {
  productId: number;
  key: string;
  name: string;
  category: string;
  label: string;
  /// The saved value when this edit was first staged.
  baseValue: number;
  /// What the server has now.
  serverValue: number;
  /// What this device wants to save.
  myValue: number;
}

/// A staged edit conflicts when the server's value has moved off the
/// baseline the edit was made against AND isn't already the value being
/// staged (in which case saving is a harmless no-op, not a conflict).
/// Edits with no recorded baseline (staged before baselines existed) and keys
/// the grid row doesn't carry (e.g. the manual-count pseudo-column) are never
/// flagged.
export function detectConflicts(
  rows: GridRow[] | null,
  pending: PendingByProduct,
  baselines: BaselineByProduct,
  columns: { key: string; label: string }[] = [],
): PendingConflict[] {
  if (!rows) return [];
  const out: PendingConflict[] = [];
  for (const [productIdStr, changes] of Object.entries(pending)) {
    const productId = Number(productIdStr);
    const row = rows.find((r) => r.product.id === productId);
    if (!row) continue;
    for (const [key, myValue] of Object.entries(changes)) {
      const base = baselines[productId]?.[key];
      const raw = row.entry[key];
      if (base === undefined || raw === undefined || raw === null) continue;
      const serverValue = Number(raw);
      if (serverValue === base || serverValue === myValue) continue;
      out.push({
        productId,
        key,
        name: row.product.name,
        category: row.product.category,
        label: columns.find((c) => c.key === key)?.label ?? key,
        baseValue: base,
        serverValue,
        myValue,
      });
    }
  }
  return out;
}

/// Staged cells that would write the value the server already has - a 0 typed
/// over a 0, or an edit another device has since made redundant after a
/// refresh. They are not changes: leaving them in keeps Save lit and puts
/// no-ops in the Preview. Cells the row doesn't carry a figure for (the
/// manual-count pseudo-column, extra columns) are kept, since there is
/// nothing to compare against.
export function dropNoOpChanges(
  rows: GridRow[] | null,
  pending: PendingByProduct,
): PendingByProduct {
  if (!rows) return pending;
  const out: PendingByProduct = {};
  for (const [productIdStr, changes] of Object.entries(pending)) {
    const row = rows.find((r) => r.product.id === Number(productIdStr));
    const kept = Object.fromEntries(
      Object.entries(changes).filter(([key, value]) => {
        const raw = row?.entry[key];
        return raw === undefined || raw === null || Number(raw) !== value;
      }),
    );
    if (Object.keys(kept).length > 0) out[Number(productIdStr)] = kept;
  }
  return out;
}

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

function loadBaselines(storageKey: string | undefined): BaselineByProduct {
  const key = baselineKeyFor(storageKey);
  if (!key) return {};
  try {
    const raw = sessionStorage.getItem(key);
    return raw ? (JSON.parse(raw) as BaselineByProduct) : {};
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
  recompute?: (
    entry: Record<string, unknown>,
    changes: Record<string, number>,
  ) => Record<string, unknown>,
) {
  const [pending, setPending] = useState<PendingByProduct>(() =>
    loadPending(storageKey),
  );
  const [baselines, setBaselines] = useState<BaselineByProduct>(() =>
    loadBaselines(storageKey),
  );
  // Ctrl+Z / Ctrl+Shift+Z over the staged (not yet saved) edits. Snapshots
  // are whole pending+baseline sets rather than per-cell diffs, which keeps
  // undo correct for a Quick Fill that touches dozens of cells at once -
  // that stages through stageMany and so costs exactly one history step,
  // the same as a single typed cell. Not persisted: like any other undo
  // stack it belongs to the current editing session, while `pending` itself
  // survives navigation via sessionStorage.
  const [past, setPast] = useState<Snapshot[]>([]);
  const [future, setFuture] = useState<Snapshot[]>([]);

  // Re-derives pending from storage only when the key itself changes (a
  // different date/shift/page) - the persistence effect below is what reacts
  // to every actual edit. Done during render (not an effect) per React's
  // "adjusting state when a prop changes" pattern, so switching storageKey
  // never renders a stale frame with the previous key's pending set first.
  const [loadedForKey, setLoadedForKey] = useState(storageKey);
  if (storageKey !== loadedForKey) {
    setLoadedForKey(storageKey);
    setPending(loadPending(storageKey));
    setBaselines(loadBaselines(storageKey));
    // A different date/shift/page is a different sheet - its edits are not
    // something the previous sheet's undo stack should be able to reach.
    setPast([]);
    setFuture([]);
  }

  useEffect(() => {
    if (!storageKey) return;
    try {
      // No trailing empty `{}` entries left behind once every edit in a
      // given date/shift is saved or discarded.
      if (Object.keys(pending).length === 0)
        sessionStorage.removeItem(storageKey);
      else sessionStorage.setItem(storageKey, JSON.stringify(pending));
    } catch {
      // Best effort, per the note above - editing still works either way.
    }
  }, [pending, storageKey]);

  useEffect(() => {
    const key = baselineKeyFor(storageKey);
    if (!key) return;
    try {
      if (Object.keys(baselines).length === 0) sessionStorage.removeItem(key);
      else sessionStorage.setItem(key, JSON.stringify(baselines));
    } catch {
      // Best effort, same as above.
    }
  }, [baselines, storageKey]);

  // What the grid should actually render - the last-saved rows with any
  // staged-but-not-yet-saved edits overlaid on top, so typing a value shows
  // up immediately without a round trip. `recompute` (if given) then
  // re-derives the locked/computed columns from that same staged diff, so
  // e.g. a changed Opening Stock is reflected in Offline/Online Stocks and
  // Remaining Stock right away too - otherwise those would keep showing
  // last-saved figures until the edit is actually Saved.
  // The set the page sees: staged cells minus any that equal what is saved.
  const effectivePending = useMemo(
    () => dropNoOpChanges(rows, pending),
    [rows, pending],
  );
  const displayRows = useMemo(() => {
    if (!rows || Object.keys(effectivePending).length === 0) return rows;
    return rows.map((r) => {
      const changes = effectivePending[r.product.id];
      if (!changes) return r;
      const merged = { ...r.entry, ...changes };
      const entry = recompute
        ? { ...merged, ...recompute(r.entry, changes) }
        : merged;
      return { ...r, entry, isSaved: false };
    });
  }, [rows, effectivePending, recompute]);

  /// Stages one cell's edit. Editing a cell back to its last-saved value
  /// removes it from the pending set entirely, rather than leaving a
  /// no-op change sitting in Preview/Save.
  /// Records the state about to be replaced, so the next Ctrl+Z restores it.
  /// Reads `pending`/`baselines` from the current render, which is the
  /// committed state for the discrete user events (blur, Enter, a Quick Fill
  /// click) that are the only things able to stage an edit.
  function pushHistory() {
    setPast((p) => [...p, { pending, baselines }].slice(-HISTORY_LIMIT));
    // A fresh edit is a new branch - anything previously undone is no longer
    // reachable by redo, the standard undo-stack rule.
    setFuture([]);
  }

  /// Applies one cell's edit to both maps. Pure, so `stage` (one cell) and
  /// `stageMany` (Quick Fill, many cells) share the same semantics - notably
  /// "edited back to its saved value" dropping out of the pending set
  /// entirely rather than lingering as a no-op change in Preview/Save.
  function applyEdit(
    state: Snapshot,
    productId: number,
    key: string,
    value: number,
    savedValue: number,
  ): Snapshot {
    const productPending = { ...(state.pending[productId] ?? {}) };
    const productBase = { ...(state.baselines[productId] ?? {}) };

    if (value === savedValue) {
      delete productPending[key];
      delete productBase[key];
    } else {
      productPending[key] = value;
      // Only the first stage of a key records its baseline - re-editing an
      // already-staged cell must keep the value it originally started from.
      if (productBase[key] === undefined && Number.isFinite(savedValue))
        productBase[key] = savedValue;
    }

    const nextPending = { ...state.pending };
    if (Object.keys(productPending).length === 0) delete nextPending[productId];
    else nextPending[productId] = productPending;

    const nextBaselines = { ...state.baselines };
    if (Object.keys(productBase).length === 0) delete nextBaselines[productId];
    else nextBaselines[productId] = productBase;

    return { pending: nextPending, baselines: nextBaselines };
  }

  function stage(
    productId: number,
    key: string,
    value: number,
    savedValue: number,
  ) {
    pushHistory();
    setPending(
      (prev) =>
        applyEdit(
          { pending: prev, baselines },
          productId,
          key,
          value,
          savedValue,
        ).pending,
    );
    setBaselines(
      (prev) =>
        applyEdit(
          { pending, baselines: prev },
          productId,
          key,
          value,
          savedValue,
        ).baselines,
    );
  }

  /// Stages a batch of cell edits as ONE undoable step - what Quick Fill
  /// (fill a value down a column, zero a whole category) commits. Folding
  /// them through applyEdit in sequence means a fill behaves exactly as if
  /// each cell had been typed, including dropping cells whose fill value
  /// happens to equal what was already saved.
  function stageMany(
    edits: {
      productId: number;
      key: string;
      value: number;
      savedValue: number;
    }[],
  ) {
    if (edits.length === 0) return;
    pushHistory();
    const next = edits.reduce(
      (state, e) => applyEdit(state, e.productId, e.key, e.value, e.savedValue),
      { pending, baselines },
    );
    setPending(next.pending);
    setBaselines(next.baselines);
  }

  function undo() {
    if (past.length === 0) return;
    const previous = past[past.length - 1];
    setPast((p) => p.slice(0, -1));
    setFuture((f) => [{ pending, baselines }, ...f].slice(0, HISTORY_LIMIT));
    setPending(previous.pending);
    setBaselines(previous.baselines);
  }

  function redo() {
    if (future.length === 0) return;
    const next = future[0];
    setFuture((f) => f.slice(1));
    setPast((p) => [...p, { pending, baselines }].slice(-HISTORY_LIMIT));
    setPending(next.pending);
    setBaselines(next.baselines);
  }

  /// Drops one product's pending changes once they've been saved (or the
  /// user discards them) - not the whole set, so a partial-failure Save
  /// (some products saved, some didn't) can clear just the successful ones.
  function clear(productId: number) {
    // Called once per product as a Save succeeds. Those edits are now
    // server state, so the history that could put them back is dropped -
    // otherwise Ctrl+Z would re-stage values that are already saved and
    // silently queue them to be written again.
    setPast([]);
    setFuture([]);
    setPending((prev) => {
      if (!(productId in prev)) return prev;
      const next = { ...prev };
      delete next[productId];
      return next;
    });
    setBaselines((prev) => {
      if (!(productId in prev)) return prev;
      const next = { ...prev };
      delete next[productId];
      return next;
    });
  }

  function clearAll() {
    setPending({});
    setBaselines({});
    setPast([]);
    setFuture([]);
  }

  /// Conflict resolution for one staged edit (see detectConflicts):
  /// "mine" re-bases it onto what the server has now (keeping the staged
  /// value, which then saves over the newer one); "server" discards the
  /// staged edit and keeps the server's value.
  function resolveConflict(
    c: Pick<PendingConflict, "productId" | "key" | "serverValue">,
    choice: "mine" | "server",
  ) {
    if (choice === "mine") {
      setBaselines((prev) => ({
        ...prev,
        [c.productId]: { ...(prev[c.productId] ?? {}), [c.key]: c.serverValue },
      }));
      return;
    }
    for (const setter of [setPending, setBaselines]) {
      setter((prev) => {
        const productMap = { ...(prev[c.productId] ?? {}) };
        delete productMap[c.key];
        const next = { ...prev };
        if (Object.keys(productMap).length === 0) delete next[c.productId];
        else next[c.productId] = productMap;
        return next;
      });
    }
  }

  return {
    pending: effectivePending,
    baselines,
    displayRows,
    stage,
    stageMany,
    clear,
    clearAll,
    resolveConflict,
    undo,
    redo,
    canUndo: past.length > 0,
    canRedo: future.length > 0,
    /// Products with at least one staged edit - what Save iterates over.
    pendingCount: Object.keys(effectivePending).length,
    /// Individual cells staged. Always >= pendingCount, and the figure the
    /// "N unsaved changes" indicator shows: an encoder who changed four
    /// cells on one product has made four changes, not one.
    pendingCellCount: Object.values(effectivePending).reduce(
      (n, changes) => n + Object.keys(changes).length,
      0,
    ),
  };
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
      if (
        k &&
        (k.startsWith(ENTRY_PREFIX) ||
          k.startsWith(MANUAL_COUNT_PREFIX) ||
          k.startsWith(BASELINE_PREFIX) ||
          k.startsWith(EXTRA_COLUMNS_PREFIX) ||
          k.startsWith("ala-eh-focus:"))
      )
        keys.push(k);
    }
    keys.forEach((k) => sessionStorage.removeItem(k));
  } catch {
    // best-effort, same as the rest of this file
  }
  // The localStorage mirror of those edits (utils/draftBackup.ts) has to go
  // too - otherwise the next sign-in would restore what was just discarded
  // (a confirmed log out) or wiped (Data Reset).
  clearDraftBackups();
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
