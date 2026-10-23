import { useBusyAction } from "../hooks/useBusyAction";
import { useEffect, useMemo, useState } from "react";
import { rememberSheet, resumeSheet } from "../utils/sheetView";
import { StockGrid, type GridRow } from "../components/StockGrid";
import { getOfflineGrid, saveOfflineEntry } from "../api/offlineStock";
import { useAuth } from "../context/AuthContext";
import { Button } from "../components/ui";
import { useZoom, zoomStyle } from "../components/ZoomControl";
import { DayLockBanner, FinishEarlierDayBanner } from "../components/FinishDay";
import { EntryToolbar } from "../components/EntryToolbar";
import { belowZeroWarnings } from "../utils/finishWarnings";
import { useDayLock } from "../hooks/useDayLock";
import { useSaveShortcut } from "../hooks/useSaveShortcut";
import { PageHeader } from "../components/PageHeader";
import { TableSkeleton } from "../components/Skeleton";
import { LoadingOverlay } from "../components/Spinner";
import { useTopProgress } from "../hooks/useTopProgress";
import { useResetOnKeyChange } from "../hooks/useResetOnKeyChange";
import { saveManualCount } from "../api/manualCounts";
import {
  MANUAL_COUNT_KEY,
  manualCountColumn,
} from "../hooks/useEntryManualCounts";
import { useRealtimeVersion } from "../context/RealtimeContext";
import { Modal } from "../components/Modal";
import { Toast } from "../components/Toast";
import { PendingChangesPreview } from "../components/PendingChangesPreview";
import { invalidateRecordHistory } from "../utils/cellHistory";
import { ConflictResolution } from "../components/ConflictResolution";
import { useOnlineStatus } from "../hooks/useOnlineStatus";
import {
  describePendingChanges,
  detectConflicts,
  usePendingEntryChanges,
} from "../hooks/usePendingEntryChanges";
import { offlineStockColumns as columns } from "../config/stockColumns";
import {
  columnsWithExtras,
  extraColumnList,
  extraColumnsFromRows,
  flattenExtraPayload,
  extraColumnKey,
  MAX_EXTRAS_PER_COLUMN,
  useGridExtraColumns,
  withoutExtraColumns,
} from "../hooks/useExtraColumns";
import { useExtraLabels } from "../hooks/useExtraLabels";
import { matchesSearch } from "../utils/search";
import {
  matchesRowFilter,
  useRowFilter,
  useSavedValueLookup,
  useUndoRedoKeys,
} from "../hooks/useGridView";
import { formatDateDisplay } from "../utils/dateFormat";
import { downloadTablePdf } from "../utils/tablePdf";
import { filterNotes, pdfFileName, stockGridSection } from "../utils/pdfTables";
import {
  getCurrentShiftAndDate,
  otherShift,
  SHIFT_LABELS,
  shiftWithWord,
} from "../utils/shift";
import {
  calculateOfflineRemaining,
  calculateOfflineStock,
} from "../utils/stockMath";
import { colors } from "../theme";
import type { Shift } from "../types";

/// Re-derives Offline Stocks + Remaining Stock from a last-saved entry
/// plus a staged (not-yet-saved) diff on top of it - shared by the live grid
/// preview (usePendingEntryChanges' `recompute`, below) and validateImportRow's
/// advisory negative-stock pre-check, so the two never drift apart on what
/// "the new figures would be" actually means.
function computeOfflineFigures(
  entry: Record<string, unknown>,
  changes: Record<string, number>,
) {
  const openingStock = changes.openingStock ?? Number(entry.openingStock ?? 0);
  const stockInOlToOff =
    changes.stockInOlToOff ?? Number(entry.stockInOlToOff ?? 0);
  const stockOutOffToOl =
    changes.stockOutOffToOl ?? Number(entry.stockOutOffToOl ?? 0);
  const productionIn = changes.productionIn ?? Number(entry.productionIn ?? 0);
  const backloads = changes.backloads ?? Number(entry.backloads ?? 0);
  const upsellOut = changes.upsellOut ?? Number(entry.upsellOut ?? 0);
  // Read straight off the column, same as every other figure here. Any extra
  // columns it was broken into stage their own total into it (see
  // useGridExtraColumns.commitExtraCell), so this is already their sum.
  const deliveryOut = changes.deliveryOut ?? Number(entry.deliveryOut ?? 0);

  const offlineStock = calculateOfflineStock(
    openingStock,
    stockInOlToOff,
    stockOutOffToOl,
  );
  const remainingStock = calculateOfflineRemaining(
    offlineStock,
    productionIn,
    deliveryOut,
    backloads,
    upsellOut,
  );
  return { deliveryOut, offlineStock, remainingStock };
}

export function OfflineEntryPage() {
  const { user } = useAuth();
  const progress = useTopProgress();
  // Defaults to whatever shift+date an encoder opening this page right now
  // is almost certainly working on (see getCurrentShiftAndDate) - date and
  // shift are picked together, not independently, since Night crosses
  // midnight and belongs to the *previous* calendar date after 12am.
  const [{ date, shift }, setDateShift] = useState(
    () => resumeSheet("offline") ?? getCurrentShiftAndDate(),
  );
  // Remembered so coming back from another page reopens the sheet whose
  // unsaved edits were being encoded (see utils/sheetView.ts).
  useEffect(() => {
    rememberSheet("offline", date, shift);
  }, [date, shift]);
  const setDate = (d: string) => setDateShift((prev) => ({ ...prev, date: d }));
  const setShift = (s: Shift) =>
    setDateShift((prev) => ({ ...prev, shift: s }));
  const [rows, setRows] = useState<GridRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Names of products whose transfer change is waiting for an admin's approval.
  const [heldNotice, setHeldNotice] = useState<string | null>(null);
  const [zoom, setZoom] = useZoom("offline-entry");
  const [query, setQuery] = useState("");
  const [categoryFilter, setCategoryFilter] = useState("");
  const [rowFilter, setRowFilter] = useRowFilter("ala-eh-rowfilter:offline");
  const [saving, setSaving] = useState(false);
  // The save status beside the Save button: when the last save on THIS sheet went
  // through, and whether the last attempt failed.
  const [savedAt, setSavedAt] = useState<number | null>(null);
  const [saveFailed, setSaveFailed] = useState(false);
  // Bumped by Edit > Refresh to re-read the sheet from the server.
  const [refreshTick, setRefreshTick] = useState(0);
  // Real per-item percent (see handleSaveAll) for LoadingOverlay's ring -
  // kept local to this page rather than routed through the shared top
  // progress bar, so Save shows exactly one animation instead of stacking
  // the overlay's spinner on top of the top bar on top of the still-open
  // Preview dialog's animated border.
  const [savePercent, setSavePercent] = useState(0);
  const [showPreview, setShowPreview] = useState(false);
  const [showClearConfirm, setShowClearConfirm] = useState(false);
  // Expand/collapse-all for the grid's category rows. The grid owns the
  // per-category state; this is the toolbar icon's side of it - a command
  // (id makes repeat clicks distinct) going in, and whether anything is
  // currently expanded coming back out so the icon can flip.
  const [catCommand, setCatCommand] = useState<{
    expanded: boolean;
    id: number;
  } | null>(null);
  const [anyCatExpanded, setAnyCatExpanded] = useState(false);
  // productId -> the Import History batch its still-staged Manual Count came
  // from - see OnlineEntryPage.tsx's matching state for the full reasoning.
  const [importedBatchByProduct, setImportedBatchByProduct] = useState<
    Record<number, number>
  >({});
  const roleCanEdit =
    user?.role === "OFFLINE_ENCODER" || user?.role === "SUPERVISOR_ADMIN";
  const realtimeVersion = useRealtimeVersion();
  const { online, reconnects } = useOnlineStatus();
  // A finished day is frozen: the sheet opens read-only with its saved state
  // (the server refuses writes to it too - see assertPeriodOpen).
  const dayLock = useDayLock(date, shift, `${realtimeVersion}:${reconnects}`, "OFFLINE");
  // Read-only while an earlier day still has to be finished (days go in order) -
  // unless an admin has turned that rule off in Settings > Entry Rules.
  // Whole-day mode on a day that was entered by shift: the sheet shows the two
  // shifts added together and cannot be edited (the server refuses it too).
  const splitDayView = rows?.some((r) => (r.entry as Record<string, unknown>).wholeDayCombined === true) ?? false;
  const canEdit = roleCanEdit && !dayLock.locked && !dayLock.entryBlockedBy && !splitDayView;

  // Cell edits are staged here instead of hitting the save endpoint
  // immediately - Save (below) flushes them all at once, and Preview shows
  // exactly what's about to be submitted first (Section 3.1). Persisted to
  // sessionStorage under this date+shift's own key, so navigating to another
  // page and back - or just switching shift/date and back - doesn't lose an
  // edit still in progress.
  const {
    pending,
    baselines,
    displayRows,
    stage,
    stageMany,
    clear,
    clearAll,
    resolveConflict,
    undo,
    redo,
    canUndo,
    canRedo,
    pendingCount,
    pendingCellCount,
  } = usePendingEntryChanges(
    rows,
    `ala-eh-pending:offline:${date}:${shift}`,
    computeOfflineFigures,
  );

  // Edits staged against values the server has since changed (typically made
  // offline, or before another user saved) - surfaced for side-by-side
  // resolution and blocking Save until decided.
  const conflicts = useMemo(
    () =>
      detectConflicts(rows, pending, baselines, [
        ...columns,
        manualCountColumn,
      ]),
    [rows, pending, baselines],
  );

  const csvColumns = useMemo(() => [...columns, manualCountColumn], []);
  const gridColumns = columns;

  // Search and the category dropdown only affect what's displayed in the
  // grid - both are local filters over the same already-loaded rows, not a
  // separate request per category.
  const categories = Array.from(
    new Set((rows ?? []).map((r) => r.product.category)),
  ).sort();
  const visibleRows = displayRows?.filter(
    (r) =>
      matchesSearch(
        [r.product.sku, r.product.name, r.product.category],
        query,
      ) &&
      (categoryFilter === "" || r.product.category === categoryFilter) &&
      matchesRowFilter(r, rowFilter, pending),
  );

  // Last-saved figures, for the grid's unusual-jump warning and for Quick
  // Fill's "is this actually a change?" test - `displayRows` already has
  // staged edits overlaid, so it can't answer either question.
  const getSavedValue = useSavedValueLookup(rows);

  // Extra input columns added from a column header's right-click menu. Their
  // amounts stage through the same pending set as any other cell; the column
  // they were added to carries their total, which is what Remaining Stock,
  // the totals rows, the variance and the % column all keep reading.
  const {
    extras,
    addColumns,
    removeColumns,
    markSaved,
    commitExtraCell,
    withExtraTotals,
    buildSavePayload,
  } = useGridExtraColumns({
    storageKey: `ala-eh-extracols:offline:${date}:${shift}`,
    rows,
    pending,
    stageMany,
    getSavedValue,
    columns,
  });

  // A finished (or otherwise read-only) sheet shows exactly the columns that
  // were saved with it: unsaved columns left in this browser's draft storage
  // never appear on it, and its columns cannot be added to or removed.
  const shownExtras = useMemo(
    () => (canEdit ? extras : extraColumnsFromRows(rows, columns)),
    [canEdit, extras, rows],
  );

  const extraLabels = useExtraLabels("OFFLINE", date, shift, setError);

  function handleAddExtraColumns(mainKey: string, count: number) {
    if (addColumns(mainKey, count) === 0)
      setError(
        `A column can have at most ${MAX_EXTRAS_PER_COLUMN} extra columns.`,
      );
  }

  // Column labels the Preview/Discard dialogs resolve a staged edit's key
  // against - the grid's own columns plus whichever extra columns currently
  // exist, so an added column's amount reads as "Stocks In (Off-Ol) +2"
  // rather than its raw storage key.
  const previewColumns = useMemo(
    () => [
      ...csvColumns,
      ...extraColumnList(columns, extras, extraLabels.names),
    ],
    [csvColumns, extras, extraLabels.names],
  );

  // Ctrl+Z / Ctrl+Shift+Z over staged edits, while any exist to undo.
  useUndoRedoKeys(undo, redo, canEdit);
  // Ctrl+S opens the same review the Save button opens (and does nothing with no
  // changes); on an editable sheet it also keeps the browser's "Save page as".
  useSaveShortcut(() => {
    if (pendingCount > 0 && !saving && conflicts.length === 0) setShowPreview(true);
  }, canEdit);

  useResetOnKeyChange(`${date}:${shift}`, () => {
    setRows(null);
    setSavedAt(null);
    setSaveFailed(false);
    // Pending edits aren't cleared here - usePendingEntryChanges re-derives
    // its own state from storage as soon as its date+shift-keyed storageKey
    // changes, so the shift being left keeps whatever it had staged (still
    // there if switched back to) and the one being loaded picks up whatever
    // it already had staged (if any), instead of both always starting empty.
  });
  useEffect(() => {
    // Ignore a response that lands after the date/shift changed (or after a
    // newer refetch started) - otherwise a slow reply for the old sheet would
    // overwrite the new one and edits would be diffed against the wrong rows.
    let cancelled = false;
    getOfflineGrid(date, shift)
      .then((data) => {
        if (!cancelled) setRows(data as unknown as GridRow[]);
      })
      .catch((e) => {
        if (!cancelled) setError(e.message);
      });
    return () => {
      cancelled = true;
    };
  }, [date, shift, realtimeVersion, reconnects, refreshTick]);

  // Best-effort check of whether the *other* shift already has saved
  // entries for this date - surfaced as a banner below, so switching (or
  // auto-defaulting) across the 4pm/1am boundary doesn't silently open a
  // second, near-empty record when the shift that's actually still open
  // already has work in it. Never blocks the page if this call fails.
  const [otherShiftCount, setOtherShiftCount] = useState<number | null>(null);
  const [dismissedShiftWarning, setDismissedShiftWarning] = useState<
    string | null
  >(null);
  useResetOnKeyChange(`${date}:${shift}`, () => setOtherShiftCount(null));
  useEffect(() => {
    let cancelled = false;
    getOfflineGrid(date, otherShift(shift))
      .then((data) => {
        if (!cancelled)
          setOtherShiftCount(
            (data as unknown as GridRow[]).filter((r) => r.isSaved).length,
          );
      })
      .catch(() => {
        if (!cancelled) setOtherShiftCount(null);
      });
    return () => {
      cancelled = true;
    };
  }, [date, shift, realtimeVersion, reconnects]);

  // Warn before navigating/closing the tab with unsaved edits still staged -
  // easy to forget Save is a separate step now that cells no longer commit
  // on blur.
  useEffect(() => {
    if (pendingCount === 0) return;
    function onBeforeUnload(e: BeforeUnloadEvent) {
      e.preventDefault();
    }
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, [pendingCount]);

  // One round trip per edit instead of two - the save endpoint already
  // returns the recalculated row.
  function mergeEntry(productId: number, saved: unknown) {
    setRows(
      (prev) =>
        prev?.map((r) =>
          r.product.id === productId
            ? { ...r, entry: saved as unknown as typeof r.entry, isSaved: true }
            : r,
        ) ?? prev,
    );
  }

  // Stages the edit locally instead of saving immediately - see
  // usePendingEntryChanges. `rows` (not displayRows) is the source of the
  // last-saved value, so re-editing a cell back to its saved value still
  // correctly drops it from the pending set.
  /// Quick Fill's batch, staged as a single undo step. Cells whose fill value
  /// already matches what's saved drop out inside the hook, so filling a
  /// column that's already correct stages nothing rather than queueing a
  /// screenful of no-op writes.
  function handleCommitMany(
    edits: { productId: number; key: string; value: number }[],
  ) {
    // withExtraTotals re-totals any main column whose added columns this
    // batch touched (Clear all over a category), so the sum can never drift
    // from the amounts behind it.
    stageMany(
      withExtraTotals(
        edits.map((e) => ({
          ...e,
          savedValue: getSavedValue(e.productId, e.key) ?? 0,
        })),
      ),
    );
  }

  function handleCommit(productId: number, key: string, value: number) {
    // An added column's cell re-stages its main column's total alongside it,
    // as a single undo step - see hooks/useExtraColumns.ts.
    if (commitExtraCell(productId, key, value)) return;
    const savedValue = Number(
      rows?.find((r) => r.product.id === productId)?.entry[key] ?? 0,
    );
    stage(productId, key, value, savedValue);
    if (key === MANUAL_COUNT_KEY) {
      setImportedBatchByProduct((prev) => {
        if (!(productId in prev)) return prev;
        const next = { ...prev };
        delete next[productId];
        return next;
      });
    }
  }

  // Flushes every staged product's changes in one pass - each product is
  // still its own request (the endpoint is per-product/date, same as a
  // manual edit or a CSV import row), but the user only triggers this once
  // for however many cells they've touched. Returns whether every staged
  // change actually saved - handlePrintConfirm (below) needs that to know
  // whether it's safe to let a "Save & Print" through.
  async function handleSaveAll(): Promise<boolean> {
    setError(null);
    setSaveFailed(false);
    // Column names still being typed are saved with the sheet.
    await extraLabels.flush();
    if (!online) {
      setError("Server unreachable. Reconnect before saving changes.");
      setSaveFailed(true);
      return false;
    }
    if (conflicts.length > 0) {
      setShowPreview(false);
      return false;
    }
    // Re-read the sheet right before saving so an edit made against stale
    // (or offline-cached) data is caught as a conflict instead of silently
    // overwriting someone else's newer value.
    try {
      const fresh = (await getOfflineGrid(date, shift)) as unknown as GridRow[];
      setRows(fresh);
      if (detectConflicts(fresh, pending, baselines).length > 0) {
        setShowPreview(false);
        return false;
      }
    } catch (e) {
      setError(
        e instanceof Error
          ? `Couldn't check for newer changes: ${e.message}`
          : "Couldn't check for newer changes.",
      );
      setSaveFailed(true);
      return false;
    }
    setSaving(true);
    setSavePercent(0);
    // Close the Preview dialog now rather than after the loop below: it's
    // built on Modal, whose border keeps sweeping the whole time it's
    // mounted (Modal.tsx's ae-modal-border-sweep), so leaving it open for
    // the duration of the save stacked a second animation behind
    // LoadingOverlay's ring for no reason - nothing in it needs to stay
    // visible once Save has actually started.
    setShowPreview(false);
    const failed: string[] = [];
    const heldNames: string[] = [];
    const savedManualCountIds: number[] = [];
    const entries = Object.entries(pending);
    for (let i = 0; i < entries.length; i++) {
      const [productIdStr, changes] = entries[i];
      const productId = Number(productIdStr);
      const priorRow = rows?.find((r) => r.product.id === productId);

      try {
        const { [MANUAL_COUNT_KEY]: manualCount, ...staged } = changes;
        // An added column's own amount is draft state; the main column is
        // already staged as the sum of them. The amounts themselves travel in
        // `extras` below so the columns come back after a reload.
        const entryChanges = withoutExtraColumns(staged);
        const { extras: extraPayload, clearExtraColumns } =
          buildSavePayload(productId);
        if (
          Object.keys(entryChanges).length > 0 ||
          extraPayload.length > 0 ||
          clearExtraColumns.length > 0
        ) {
          const saved = await saveOfflineEntry(productId, date, shift, {
            ...entryChanges,
            extras: extraPayload,
            clearExtraColumns,
          });
          // The endpoint returns the daily row, which carries only each
          // column's total - folding the amounts back on keeps the added
          // columns showing their figures without a second round trip.
          const { heldForApproval, ...savedRow } = saved;
          if (heldForApproval?.length)
            heldNames.push(priorRow?.product.name ?? `#${productId}`);
          // A held column's amounts were not saved, so they are not shown as if
          // they were.
          const heldKeys = new Set(heldForApproval?.map((h) => h.field));
          mergeEntry(productId, {
            ...(savedRow as unknown as Record<string, unknown>),
            ...flattenExtraPayload(
              extraPayload.filter((e) => !heldKeys.has(e.columnKey)),
            ),
          });
        }
        // After the entry itself, so the count's variance is measured
        // against the freshly saved Remaining Stock.
        if (manualCount !== undefined) {
          await saveManualCount(
            productId,
            date,
            shift,
            "OFFLINE",
            manualCount,
            importedBatchByProduct[productId],
          );
          savedManualCountIds.push(productId);
        }
        clear(productId);
      } catch (e) {
        const name = priorRow?.product.name ?? `#${productId}`;
        // The server's own message (e.g. the negative-stock guard's "would
        // end at -5") is the actual reason - without it, every failure looks
        // identical ("still shown as unsaved, try Save again.") no matter
        // what actually went wrong, leaving nothing to act on.
        const reason = e instanceof Error ? e.message : "unknown error";
        failed.push(`${name} (${reason})`);
      }
      setSavePercent(Math.round(((i + 1) / entries.length) * 100));
    }
    setSaving(false);
    // The change-log cache is keyed per saved row and never expires on its
    // own, so without this a cell's hover tooltip and "View history" popover
    // would keep showing the state from before this save - i.e. never show
    // the encoder their own edit.
    invalidateRecordHistory();
    if (savedManualCountIds.length > 0) {
      setImportedBatchByProduct((prev) => {
        const next = { ...prev };
        for (const id of savedManualCountIds) delete next[id];
        return next;
      });
    }
    if (failed.length) {
      setError(`Failed to save: ${failed.join("; ")}`);
    }
    if (heldNames.length)
      setHeldNotice(
        `${heldNames.join(", ")}: the transfer change was not applied because Online is already finished for this shift. It was sent to an admin for approval (Corrections) and applies to both pages once approved. Everything else was saved.`,
      );
    // Deleted columns are gone from the server now too.
    if (failed.length === 0) {
      markSaved();
      setSavedAt(Date.now());
    } else {
      setSaveFailed(true);
    }
    return failed.length === 0;
  }

  // Discards every currently-staged edit (manual or imported) without
  // saving any of it - the counterpart to Save for "actually I don't want
  // any of this", so an encoder doesn't have to hand-revert each cell (or
  // reload the page and lose the sessionStorage-persisted draft some other
  // way). Never touches the server - there's nothing to undo once this
  // runs.
  function handleClearAll() {
    clearAll();
    setShowClearConfirm(false);
  }

  // PDF of the grid as currently filtered (search / category), with every
  // category fully listed. Built from the row data by utils/tablePdf.ts - not
  // by printing the page - so the layout is the same on every page and
  // always fits the paper. Disabled while edits are unsaved (see the button).
  const pdfAction = useBusyAction();

  async function handlePdf() {
    // Same rule as the button's disabled state: any staged (green) edit locks
    // the PDF again until it's saved or discarded.
    if (!visibleRows || pendingCount > 0) return;
    const pdfName = pdfFileName("offline-stock", date, shift);
    try {
      await progress.track(() =>
        downloadTablePdf({
          filename: pdfName,
          title: "Daily Offline Stock Monitoring",
          subtitle: `${formatDateDisplay(date)} - ${shiftWithWord(shift)}`,
          notes: filterNotes({ category: categoryFilter, query }),
          // Added columns print beside the column they add up to; with
          // none, this is the same column list - and the same PDF - as
          // before.
          sections: [
            stockGridSection(visibleRows, columnsWithExtras(columns, shownExtras, extraLabels.names)),
          ],
        }),
      );
    } catch (e) {
      setError(e instanceof Error ? `PDF failed: ${e.message}` : "PDF failed");
    }
  }

  const otherShiftWarning =
    otherShiftCount !== null && otherShiftCount > 0
      ? `${SHIFT_LABELS[otherShift(shift)]} already has ${otherShiftCount} saved entr${otherShiftCount === 1 ? "y" : "ies"} for ${date} - double-check you're on the right shift before entering data.`
      : null;

  return (
    <div>
      <PageHeader
        title={`Daily Offline Stock Monitoring - ${formatDateDisplay(date)} - ${shiftWithWord(shift)}`}
        subtitle="Stocks In/Out transfers also update the Online table."
      >
        <EntryToolbar
          location="OFFLINE"
          date={date}
          shift={shift}
          onDateChange={setDate}
          onShiftChange={setShift}
          query={query}
          onQueryChange={setQuery}
          categories={categories}
          category={categoryFilter}
          onCategoryChange={setCategoryFilter}
          rowFilter={rowFilter}
          onRowFilterChange={setRowFilter}
          changedCount={pendingCount}
          canEdit={canEdit}
          saving={saving}
          pendingCount={pendingCount}
          pendingCellCount={pendingCellCount}
          canUndo={canUndo}
          canRedo={canRedo}
          onUndo={undo}
          onRedo={redo}
          onDiscard={() => setShowClearConfirm(true)}
          onRefresh={() => setRefreshTick((t) => t + 1)}
          copyPrevious={
            canEdit
              ? {
                  current: { date, shift },
                  columns: gridColumns,
                  rows,
                  fetchPeriod: (d, s) => getOfflineGrid(d, s).then((data) => data as unknown as GridRow[]),
                  pending,
                  getSavedValue,
                  onApply: handleCommitMany,
                }
              : null
          }
          onSave={() => setShowPreview(true)}
          saveState={saving ? "saving" : saveFailed && pendingCount > 0 ? "failed" : savedAt !== null ? "saved" : "idle"}
          savedAt={savedAt ?? undefined}
          onRetrySave={() => void handleSaveAll()}
          hasRows={!!visibleRows}
          anyExpanded={anyCatExpanded}
          onToggleExpandAll={() => setCatCommand({ expanded: !anyCatExpanded, id: Date.now() })}
          isAdmin={user?.role === "SUPERVISOR_ADMIN"}
          zoom={zoom}
          onZoomChange={setZoom}
          pdfBusy={pdfAction.busy}
          onPdf={() => void pdfAction.run(handlePdf)}
          dayLock={dayLock}
          splitDay={splitDayView}
          onFinished={dayLock.refresh}
          onError={setError}
          finishWarnings={belowZeroWarnings(rows)}
        />
      </PageHeader>
      <Toast
        message={
          otherShiftWarning && otherShiftWarning !== dismissedShiftWarning
            ? otherShiftWarning
            : null
        }
        onDismiss={() => setDismissedShiftWarning(otherShiftWarning)}
        variant="warning"
        duration={10000}
      />
      <Toast
        message={error}
        onDismiss={() => setError(null)}
        variant="error"
        duration={null}
      />
      <Toast
        message={heldNotice}
        onDismiss={() => setHeldNotice(null)}
        variant="warning"
        duration={null}
      />
      {dayLock.entryBlockedBy && !dayLock.locked && (
        <FinishEarlierDayBanner
          blockedBy={dayLock.entryBlockedBy}
          onGo={(d, s) => setDateShift({ date: d, shift: s })}
        />
      )}
      {splitDayView && (
        <p role="status" className="ae-mm-note" style={{ margin: "0 0 10px" }}>
          This day was entered by shift (Morning and Night). With shifts switched off it shows the two added together
          and is read-only. Use Request unlock in the toolbar to ask an admin to open it, switch shifts back on in Settings to edit it, or request a correction.
        </p>
      )}
      {dayLock.locked && (
        <DayLockBanner
          date={date}
          shift={shift}
          location="OFFLINE"
          closure={dayLock.closure}
          isAdmin={user?.role === "SUPERVISOR_ADMIN"}
        />
      )}
      <ConflictResolution conflicts={conflicts} onResolve={resolveConflict} />
      {!rows ? (
        <TableSkeleton
          headers={["SKU", "Product", ...columns.map((c) => c.label)]}
          minWidth={720}
          label="Loading offline entries…"
        />
      ) : (
        <div className="ae-grid-fill" style={zoomStyle(zoom)}>
          {/* Keyed by date+shift so switching either remounts the grid fresh -
              categories start collapsed again on a newly-loaded dataset
              instead of carrying over whatever was expanded on the last one.
              `pending` force-expands any category with a staged, unsaved
              edit, and `focusStorageKey` restores whichever row was last
              clicked - together, switching shifts/dates (or just navigating
              away and back here) never leaves an in-progress edit hidden or
              its row un-highlighted. */}
          <StockGrid
            key={`${date}-${shift}`}
            rows={visibleRows ?? []}
            columns={gridColumns}
            onCommit={handleCommit}
            readOnly={!canEdit}
            pending={pending}
            focusStorageKey={`ala-eh-focus:offline:${date}:${shift}`}
            percentOfTotalKey="remainingStock"
            onCommitMany={canEdit ? handleCommitMany : undefined}
            getSavedValue={getSavedValue}
            expandAllCommand={catCommand}
            onAnyExpandedChange={setAnyCatExpanded}
            extraColumns={shownExtras}
            onAddExtraColumns={canEdit ? handleAddExtraColumns : undefined}
            onRemoveExtraColumns={
              canEdit
                ? (mainKey, slots) => {
                    removeColumns(mainKey, slots);
                    for (const slot of slots)
                      extraLabels.clear(extraColumnKey(mainKey, slot));
                  }
                : undefined
            }
            extraNames={extraLabels.names}
            onExtraNameChange={canEdit ? extraLabels.change : undefined}
            onExtraNameCommit={canEdit ? extraLabels.commit : undefined}
            historyTable="daily_offline_stock"
            colorScope="offline"
          />
        </div>
      )}
      {!roleCanEdit && (
        <p style={{ fontSize: 12, color: colors.subtleInk, marginTop: 8 }}>
          Read-only: your role can view but not edit Offline entries.
        </p>
      )}
      {showPreview && (
        <Modal title="Unsaved changes" onClose={() => setShowPreview(false)}>
          <PendingChangesPreview
            items={describePendingChanges(rows, pending, previewColumns)}
          />
          <div
            style={{
              display: "flex",
              justifyContent: "flex-end",
              gap: 8,
              marginTop: 16,
            }}
          >
            <Button
              type="button"
              variant="secondary"
              size="sm"
              onClick={() => setShowPreview(false)}
            >
              Keep editing
            </Button>
            <Button
              type="button"
              size="sm"
              onClick={handleSaveAll}
              disabled={pendingCount === 0 || saving}
            >
              {saving ? "Saving…" : `Save (${pendingCount})`}
            </Button>
          </div>
        </Modal>
      )}
      {showClearConfirm && (
        <Modal
          title="Discard unsaved changes?"
          onClose={() => setShowClearConfirm(false)}
        >
          <PendingChangesPreview
            items={describePendingChanges(rows, pending, previewColumns)}
          />
          <p
            style={{
              margin: "12px 0 0",
              fontSize: 12.5,
              color: colors.subtleInk,
            }}
          >
            This clears every unsaved edit on this sheet (typed or imported) -
            nothing has been saved yet, so nothing on the server is affected.
          </p>
          <div
            style={{
              display: "flex",
              justifyContent: "flex-end",
              gap: 8,
              marginTop: 16,
            }}
          >
            <Button
              type="button"
              variant="secondary"
              size="sm"
              onClick={() => setShowClearConfirm(false)}
            >
              Keep editing
            </Button>
            <Button
              type="button"
              variant="danger"
              size="sm"
              onClick={handleClearAll}
            >
              Discard {pendingCount}
            </Button>
          </div>
        </Modal>
      )}
      {saving && (
        <LoadingOverlay label="Saving changes…" percent={savePercent} />
      )}
    </div>
  );
}
