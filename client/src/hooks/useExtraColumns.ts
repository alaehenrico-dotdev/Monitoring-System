import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { GridRow } from "../components/StockGrid";
import type { PendingByProduct } from "./usePendingEntryChanges";

/**
 * "Extra input columns" on the Online/Offline Entry grids: right-clicking an
 * editable column header adds numeric input columns directly after it, and
 * the column that was right-clicked becomes the read-only SUM of them.
 *
 * Deliberately the same shape as the Delivery (Out) slot columns that already
 * exist (config/stockColumns.ts' deliverySlotColumns, api/offlineStock.ts'
 * computeDeliverySlots): one main column whose value is the total of a set of
 * numbered sub-amounts, each of which is an ordinary grid cell staged through
 * usePendingEntryChanges like any other edit. The difference is only that
 * these are added on demand rather than fixed at five, so which ones exist
 * has to be stored somewhere - hence this hook.
 *
 * The rule for the main column's own value is the one that cannot lose a
 * number an encoder already typed: when the FIRST extra is added to a column,
 * each row's current main value is moved into that first new column, and from
 * then on the main column is purely the sum of its extras (so it reads back
 * identical the instant the columns appear). Deleting every extra leaves the
 * main column holding the last total and editable again.
 */

/// Section 4.2/4.3 grids are dense enough already; ten added columns on one
/// main column is far past any real use and keeps the header row sane.
export const MAX_EXTRAS_PER_COLUMN = 10;

/// Separator between a main column key and its added column's slot number.
/// Double underscore + x so it can never collide with a real column key
/// (every one of those is lowerCamelCase - see config/stockColumns.ts).
const EXTRA_SEP = "__x";

/// Not ENTRY_PREFIX: utils/unsavedWork.ts counts every ENTRY_PREFIX key as a
/// page's staged edits, and which columns exist is layout, not an edit.
export const EXTRA_COLUMNS_PREFIX = "ala-eh-extracols:";

/// main column key -> the slot numbers of its added columns, in display order.
/// Slot numbers are stable identities, not positions: deleting the middle one
/// of [1,2,3] leaves [1,3] rather than renumbering, so the remaining columns'
/// headers (and, in Phase 2, their stored rows) don't shift under the user.
export type ExtraColumnsByKey = Record<string, number[]>;

export function extraColumnKey(mainKey: string, slot: number): string {
  return `${mainKey}${EXTRA_SEP}${slot}`;
}

export function parseExtraColumnKey(
  key: string,
): { mainKey: string; slot: number } | null {
  const at = key.lastIndexOf(EXTRA_SEP);
  if (at <= 0) return null;
  const slot = Number(key.slice(at + EXTRA_SEP.length));
  if (!Number.isInteger(slot) || slot < 1) return null;
  return { mainKey: key.slice(0, at), slot };
}

export function isExtraColumnKey(key: string): boolean {
  return parseExtraColumnKey(key) !== null;
}

export function extraColumnLabel(mainLabel: string, slot: number): string {
  return `${mainLabel} +${slot}`;
}

/**
 * One product's staged changes with every added-column amount filtered out -
 * what actually goes to the entry save endpoint under "Save total only".
 *
 * Nothing is lost by dropping them: the main column is staged as their sum
 * (useGridExtraColumns.commitExtraCell), so the figure they add up to is
 * already in this object under the main column's own key. "Save individually"
 * (Phase 2) is what additionally stores the amounts themselves.
 */
export function withoutExtraColumns(
  changes: Record<string, number>,
): Record<string, number> {
  return Object.fromEntries(
    Object.entries(changes).filter(([key]) => !isExtraColumnKey(key)),
  );
}

/// The added columns as a flat {key,label} list - what describePendingChanges
/// and detectConflicts need to render a staged extra as something other than
/// its raw storage key.
export function extraColumnList(
  columns: { key: string; label: string }[],
  extras: ExtraColumnsByKey,
): { key: string; label: string }[] {
  return columns.flatMap((c) =>
    (extras[c.key] ?? []).map((slot) => ({
      key: extraColumnKey(c.key, slot),
      label: extraColumnLabel(c.label, slot),
    })),
  );
}

/**
 * The added columns the server has stored amounts for, read back off the
 * loaded rows: the grid endpoints flatten each stored amount onto its row
 * under the same key the client writes (server: utils/stockExtras.ts), so a
 * sheet saved with "Save individually" redraws its columns with no extra
 * request. Keys whose main column isn't in this grid's config are ignored.
 */
export function extraColumnsFromRows(
  rows: GridRow[] | null,
  columns: { key: string }[],
): ExtraColumnsByKey {
  if (!rows?.length) return {};
  const known = new Set(columns.map((c) => c.key));
  const found = new Map<string, Set<number>>();
  for (const row of rows) {
    for (const key of Object.keys(row.entry)) {
      const parsed = parseExtraColumnKey(key);
      if (!parsed || !known.has(parsed.mainKey)) continue;
      const slots = found.get(parsed.mainKey) ?? new Set<number>();
      slots.add(parsed.slot);
      found.set(parsed.mainKey, slots);
    }
  }
  const out: ExtraColumnsByKey = {};
  for (const [mainKey, slots] of found) out[mainKey] = [...slots].sort((a, b) => a - b);
  return out;
}

/// One product's extras flattened back onto a grid row, so the row the save
/// endpoint returns (which carries only the main column's total) still shows
/// the amounts behind it without waiting for a refetch.
export function flattenExtraPayload(extras: StockExtraPayload[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const e of extras) out[extraColumnKey(e.columnKey, e.slotIndex)] = e.amount;
  return out;
}

/// What one product's save sends about its added columns. Mirrors the
/// server's StockExtraInput (server: utils/stockExtras.ts).
export interface StockExtraPayload {
  columnKey: string;
  slotIndex: number;
  amount: number;
}

/**
 * The grid's columns with each added column inserted directly after the
 * column that owns it - the column list the exports and the read-only Daily
 * Report use, so an individually-saved breakdown is printed beside the total
 * it adds up to rather than being dropped from the page.
 *
 * With no extras this returns the column list unchanged, which is what keeps
 * every existing export byte-for-byte what it was.
 */
export function columnsWithExtras<T extends { key: string; label: string }>(
  columns: T[],
  extras: ExtraColumnsByKey,
): { key: string; label: string }[] {
  if (Object.keys(extras).length === 0) return columns;
  return columns.flatMap((c) => [
    c,
    ...(extras[c.key] ?? []).map((slot) => ({
      key: extraColumnKey(c.key, slot),
      label: extraColumnLabel(c.label, slot),
    })),
  ]);
}

/// The main column's value: the sum of its added columns, with one of them
/// optionally overridden by a value being committed right now (which isn't in
/// `read`'s source yet).
export function sumExtraColumns(
  mainKey: string,
  slots: number[],
  read: (key: string) => number,
  override?: { key: string; value: number },
): number {
  return slots.reduce((sum, slot) => {
    const key = extraColumnKey(mainKey, slot);
    return sum + (override && override.key === key ? override.value : read(key));
  }, 0);
}

function loadExtras(storageKey: string | undefined): ExtraColumnsByKey {
  if (!storageKey) return {};
  try {
    const raw = sessionStorage.getItem(storageKey);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as ExtraColumnsByKey;
    // Hand-edited/stale storage shouldn't be able to render a broken header.
    const out: ExtraColumnsByKey = {};
    for (const [key, slots] of Object.entries(parsed)) {
      if (!Array.isArray(slots)) continue;
      const clean = slots
        .filter((s): s is number => Number.isInteger(s) && s >= 1)
        .slice(0, MAX_EXTRAS_PER_COLUMN);
      if (clean.length) out[key] = clean;
    }
    return out;
  } catch {
    return {};
  }
}

// ---------------------------------------------------------------------------
// Save mode, remembered per column
// ---------------------------------------------------------------------------

/// "total" saves the main column's sum and drops the added columns;
/// "individual" additionally stores each added amount so it comes back as its
/// own column after a reload (Phase 2 - server-backed).
export type ExtraSaveMode = "total" | "individual";

const SAVE_MODE_STORAGE_KEY = "ala-eh-extra-savemode";

function loadSaveModes(): Record<string, ExtraSaveMode> {
  try {
    const raw = localStorage.getItem(SAVE_MODE_STORAGE_KEY);
    return raw ? (JSON.parse(raw) as Record<string, ExtraSaveMode>) : {};
  } catch {
    return {};
  }
}

/// Remembers the last "total only" / "individually" choice per column, across
/// sessions (localStorage - it's a per-viewer preference, like zoom, not
/// in-progress work). `scope` namespaces Online from Offline, which have
/// columns of the same key.
export function useExtraSaveModes(scope: string) {
  const [modes, setModes] = useState<Record<string, ExtraSaveMode>>(loadSaveModes);

  const setMode = useCallback(
    (mainKey: string, mode: ExtraSaveMode) => {
      setModes((prev) => {
        const next = { ...prev, [`${scope}:${mainKey}`]: mode };
        try {
          localStorage.setItem(SAVE_MODE_STORAGE_KEY, JSON.stringify(next));
        } catch {
          // A preference - fine to lose rather than block the dialog.
        }
        return next;
      });
    },
    [scope],
  );

  const getMode = useCallback(
    (mainKey: string): ExtraSaveMode => modes[`${scope}:${mainKey}`] ?? "total",
    [modes, scope],
  );

  return { getMode, setMode };
}

// ---------------------------------------------------------------------------
// The grid-side hook
// ---------------------------------------------------------------------------

interface StagedEdit {
  productId: number;
  key: string;
  value: number;
  savedValue: number;
}

export interface ExtraSaveColumn {
  mainKey: string;
  label: string;
  /// How many added columns this main column currently has.
  count: number;
  /// The sum of every staged amount across every product and added column -
  /// what "Save total only" will write into the main column.
  total: number;
}

export interface UseGridExtraColumnsArgs {
  /// Namespaced by page + date + shift, same as the pending-edits key, so
  /// added columns belong to one sheet rather than following the encoder
  /// across dates.
  storageKey?: string;
  /// Last-saved rows (not the pending-overlaid display rows).
  rows: GridRow[] | null;
  pending: PendingByProduct;
  /// usePendingEntryChanges' stageMany - a whole add/delete is ONE undo step.
  stageMany: (edits: StagedEdit[]) => void;
  getSavedValue: (productId: number, key: string) => number | undefined;
  /// The grid's own column config, for labels and for listing affected columns.
  columns: { key: string; label: string }[];
}

export function useGridExtraColumns({
  storageKey,
  rows,
  pending,
  stageMany,
  getSavedValue,
  columns,
}: UseGridExtraColumnsArgs) {
  const [extras, setExtras] = useState<ExtraColumnsByKey>(() =>
    loadExtras(storageKey),
  );

  // Re-derive from storage when the sheet itself changes (date/shift), during
  // render rather than in an effect - the same pattern (and the same reason)
  // as usePendingEntryChanges' own storageKey handling.
  const [loadedForKey, setLoadedForKey] = useState(storageKey);
  if (storageKey !== loadedForKey) {
    setLoadedForKey(storageKey);
    setExtras(loadExtras(storageKey));
  }

  useEffect(() => {
    if (!storageKey) return;
    try {
      if (Object.keys(extras).length === 0) sessionStorage.removeItem(storageKey);
      else sessionStorage.setItem(storageKey, JSON.stringify(extras));
    } catch {
      // Best effort: added columns just don't survive navigation.
    }
  }, [extras, storageKey]);

  // Columns deleted on this device but not saved yet. Without this, the next
  // grid refetch (a realtime event, a reconnect, Save's own pre-check) would
  // read the still-stored amounts back off the rows and put the column the
  // encoder just removed straight back. Not persisted and not keyed by sheet:
  // it only has to outlive a refetch, and a different sheet reloads it all.
  const dismissed = useRef(new Set<string>());

  // Added columns the server already holds amounts for, folded in alongside
  // whatever this session has added. A union, not a replacement: a column
  // added here but never saved must survive a refetch too.
  const serverColumns = useMemo(
    () => extraColumnsFromRows(rows, columns),
    [rows, columns],
  );
  const [adopted, setAdopted] = useState("");
  const signature = JSON.stringify(serverColumns);
  if (signature !== adopted) {
    setAdopted(signature);
    setExtras((prev) => {
      let changed = false;
      const next = { ...prev };
      for (const [mainKey, slots] of Object.entries(serverColumns)) {
        const merged = [...new Set([...(prev[mainKey] ?? []), ...slots])]
          .filter((slot) => !dismissed.current.has(`${mainKey}:${slot}`))
          .sort((a, b) => a - b)
          .slice(0, MAX_EXTRAS_PER_COLUMN);
        if (merged.length === (prev[mainKey] ?? []).length) continue;
        next[mainKey] = merged;
        changed = true;
      }
      return changed ? next : prev;
    });
  }

  /// This product's current figure for a column - the staged value if there is
  /// one, otherwise what was last saved.
  const readCell = useCallback(
    (productId: number, key: string): number =>
      pending[productId]?.[key] ?? getSavedValue(productId, key) ?? 0,
    [pending, getSavedValue],
  );

  /**
   * Adds `count` columns after `mainKey` and returns how many were actually
   * added (fewer than asked, or 0, once the cap is reached).
   *
   * Adding the first one moves every row's current main value into it, so the
   * number an encoder already typed survives the column becoming a sum - and
   * the main column's own displayed figure doesn't change at all, since the
   * sum of the new columns is exactly what it already held.
   */
  const addColumns = useCallback(
    (mainKey: string, count: number): number => {
      const current = extras[mainKey] ?? [];
      const room = MAX_EXTRAS_PER_COLUMN - current.length;
      const n = Math.min(count, room);
      if (n <= 0) return 0;

      // Slot numbers continue past whatever has been used, so a deleted slot's
      // number is never silently reused by a different column of amounts.
      let next = current.length ? Math.max(...current) + 1 : 1;
      const added = Array.from({ length: n }, () => next++);
      setExtras((prev) => ({
        ...prev,
        [mainKey]: [...(prev[mainKey] ?? []), ...added],
      }));

      if (current.length === 0) {
        const seedKey = extraColumnKey(mainKey, added[0]);
        const edits: StagedEdit[] = [];
        for (const row of rows ?? []) {
          const id = row.product.id;
          const value = readCell(id, mainKey);
          if (!value) continue;
          edits.push({
            productId: id,
            key: seedKey,
            value,
            savedValue: getSavedValue(id, seedKey) ?? 0,
          });
        }
        if (edits.length) stageMany(edits);
      }
      return n;
    },
    [extras, rows, readCell, getSavedValue, stageMany],
  );

  /**
   * Removes added columns and re-stages each affected row's main column as the
   * sum of whatever is left - deleting a column takes its amount back out of
   * the total, rather than leaving the main column reading high.
   */
  const removeColumns = useCallback(
    (mainKey: string, slots: number[]) => {
      const current = extras[mainKey] ?? [];
      const dropped = slots.filter((s) => current.includes(s));
      if (dropped.length === 0) return;
      const remaining = current.filter((s) => !dropped.includes(s));
      for (const slot of dropped) dismissed.current.add(`${mainKey}:${slot}`);

      setExtras((prev) => {
        const left = (prev[mainKey] ?? []).filter((s) => !dropped.includes(s));
        const next = { ...prev };
        if (left.length) next[mainKey] = left;
        else delete next[mainKey];
        return next;
      });

      const droppedKeys = dropped.map((s) => extraColumnKey(mainKey, s));
      const edits: StagedEdit[] = [];
      for (const row of rows ?? []) {
        const id = row.product.id;
        const touched = droppedKeys.some(
          (k) => pending[id]?.[k] !== undefined || row.entry[k] !== undefined,
        );
        if (!touched) continue;
        for (const key of droppedKeys) {
          // Staging a cell back to its saved value drops it from the pending
          // set entirely (usePendingEntryChanges.applyEdit), which is exactly
          // what a removed column's staged amount should do.
          const savedValue = getSavedValue(id, key) ?? 0;
          edits.push({ productId: id, key, value: savedValue, savedValue });
        }
        edits.push({
          productId: id,
          key: mainKey,
          value: sumExtraColumns(mainKey, remaining, (k) => readCell(id, k)),
          savedValue: getSavedValue(id, mainKey) ?? 0,
        });
      }
      if (edits.length) stageMany(edits);
    },
    [extras, rows, pending, readCell, getSavedValue, stageMany],
  );

  /**
   * Commits one added column's cell: the amount itself plus its main column's
   * recomputed total, as a single undo step so Ctrl+Z never leaves the two
   * disagreeing. Returns false if `key` isn't an added column, so the page's
   * own commit handler can carry on with its normal path.
   */
  const commitExtraCell = useCallback(
    (productId: number, key: string, value: number): boolean => {
      const parsed = parseExtraColumnKey(key);
      const slots = parsed ? extras[parsed.mainKey] : undefined;
      if (!parsed || !slots) return false;
      stageMany([
        {
          productId,
          key,
          value,
          savedValue: getSavedValue(productId, key) ?? 0,
        },
        {
          productId,
          key: parsed.mainKey,
          value: sumExtraColumns(
            parsed.mainKey,
            slots,
            (k) => readCell(productId, k),
            { key, value },
          ),
          savedValue: getSavedValue(productId, parsed.mainKey) ?? 0,
        },
      ]);
      return true;
    },
    [extras, readCell, getSavedValue, stageMany],
  );

  /**
   * Appends each affected main column's recomputed total to a batch of cell
   * edits - what Quick Fill ("Zero all" over a category) needs, since it
   * writes added columns directly rather than cell by cell through
   * commitExtraCell and would otherwise leave the main column reading the
   * total of values it no longer holds.
   */
  const withExtraTotals = useCallback(
    (edits: StagedEdit[]): StagedEdit[] => {
      // Values this batch is about to stage, so the totals below are computed
      // against the batch rather than the state it is replacing.
      const batch = new Map<string, number>();
      const affected = new Map<number, Set<string>>();
      for (const e of edits) {
        batch.set(`${e.productId}:${e.key}`, e.value);
        const parsed = parseExtraColumnKey(e.key);
        if (!parsed || !extras[parsed.mainKey]) continue;
        const forProduct = affected.get(e.productId) ?? new Set<string>();
        forProduct.add(parsed.mainKey);
        affected.set(e.productId, forProduct);
      }
      if (affected.size === 0) return edits;

      const totals: StagedEdit[] = [];
      for (const [productId, mainKeys] of affected) {
        for (const mainKey of mainKeys) {
          totals.push({
            productId,
            key: mainKey,
            value: sumExtraColumns(mainKey, extras[mainKey], (k) =>
              batch.get(`${productId}:${k}`) ?? readCell(productId, k),
            ),
            savedValue: getSavedValue(productId, mainKey) ?? 0,
          });
        }
      }
      return [...edits, ...totals];
    },
    [extras, readCell, getSavedValue],
  );

  /// Drops the added columns for these main columns outright - what a
  /// successful "Save total only" does once their amounts are folded into the
  /// saved main column and there's nothing left for them to hold.
  const clearColumns = useCallback((mainKeys: string[]) => {
    if (mainKeys.length === 0) return;
    setExtras((prev) => {
      const next = { ...prev };
      for (const key of mainKeys) delete next[key];
      return next;
    });
    // These columns no longer exist on the server either, so there is nothing
    // left for a dismissal to suppress - and keeping one would stop the same
    // slot number being adopted again if the column is later re-added.
    for (const key of dismissed.current) {
      if (mainKeys.some((main) => key.startsWith(`${main}:`))) dismissed.current.delete(key);
    }
  }, []);

  /**
   * What one product's save sends about its added columns.
   *
   * `isIndividual` decides per main column: "Save individually" sends every
   * slot's amount (so the columns come back after a reload), while "Save total
   * only" names the column in `clearExtraColumns` instead, which drops any
   * amounts the server still holds for it. Either way the main column's own
   * total is already in the ordinary field changes - and the server recomputes
   * it from these amounts regardless, so the two cannot disagree.
   */
  const buildSavePayload = useCallback(
    (productId: number, isIndividual: (mainKey: string) => boolean) => {
      const payload: StockExtraPayload[] = [];
      const clearExtraColumns: string[] = [];
      for (const [mainKey, slots] of Object.entries(extras)) {
        if (!isIndividual(mainKey)) {
          clearExtraColumns.push(mainKey);
          continue;
        }
        for (const slot of slots) {
          payload.push({
            columnKey: mainKey,
            slotIndex: slot,
            amount: readCell(productId, extraColumnKey(mainKey, slot)),
          });
        }
      }
      return { extras: payload, clearExtraColumns };
    },
    [extras, readCell],
  );

  /// Added columns that currently hold at least one staged amount - the ones
  /// the Save dialog has to ask about. Columns added but never typed into
  /// aren't listed: there's nothing to decide for them.
  const saveColumns = useMemo<ExtraSaveColumn[]>(() => {
    const out: ExtraSaveColumn[] = [];
    for (const col of columns) {
      const slots = extras[col.key];
      if (!slots?.length) continue;
      let total = 0;
      let any = false;
      for (const changes of Object.values(pending)) {
        for (const slot of slots) {
          const v = changes[extraColumnKey(col.key, slot)];
          if (v === undefined) continue;
          total += v;
          any = true;
        }
      }
      if (any) out.push({ mainKey: col.key, label: col.label, count: slots.length, total });
    }
    return out;
  }, [columns, extras, pending]);

  /// The added columns as {key,label}, for the Preview dialog and conflict
  /// detection.
  const extraColumnDefs = useMemo(
    () => extraColumnList(columns, extras),
    [columns, extras],
  );

  return {
    extras,
    addColumns,
    removeColumns,
    clearColumns,
    commitExtraCell,
    withExtraTotals,
    buildSavePayload,
    saveColumns,
    extraColumnDefs,
  };
}
