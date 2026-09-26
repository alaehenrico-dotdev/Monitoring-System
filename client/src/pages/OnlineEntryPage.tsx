import { useEffect, useRef, useState } from "react";
import { StockGrid, type GridRow } from "../components/StockGrid";
import { getOnlineGrid, saveOnlineEntry } from "../api/onlineStock";
import { getOfflineGrid } from "../api/offlineStock";
import { useAuth } from "../context/AuthContext";
import { Button } from "../components/ui";
import { DatePicker } from "../components/DatePicker";
import { useZoom, zoomStyle, ZoomControl } from "../components/ZoomControl";
import { Toolbar, ToolbarControls } from "../components/Toolbar";
import { PageHeader } from "../components/PageHeader";
import { CsvTools, type CsvToolsHandle } from "../components/CsvTools";
import { ClearIcon, PrinterIcon, SaveIcon, UndoIcon } from "../components/icons";
import { SearchInput } from "../components/SearchInput";
import { CategoryFilter } from "../components/CategoryFilter";
import { ShiftFilter } from "../components/ShiftFilter";
import { TableSkeleton } from "../components/Skeleton";
import { LoadingOverlay } from "../components/Spinner";
import { useTopProgress } from "../hooks/useTopProgress";
import { Modal } from "../components/Modal";
import { PendingChangesPreview } from "../components/PendingChangesPreview";
import { describePendingChanges, usePendingEntryChanges, type PendingByProduct } from "../hooks/usePendingEntryChanges";
import { onlineStockColumns as columns } from "../config/stockColumns";
import { matchesSearch } from "../utils/search";
import { formatDateDisplay } from "../utils/dateFormat";
import { downloadTablePdf } from "../utils/tablePdf";
import { filterNotes, pdfFileName, stockGridSection } from "../utils/pdfTables";
import { getCurrentShiftAndDate, otherShift, SHIFT_LABELS, SHIFT_SHORT_LABELS } from "../utils/shift";
import { calculateOfflineRemaining, calculateOfflineStock, calculateOnlineRemaining, calculateOnlineStock, isNegativeStock } from "../utils/stockMath";
import { colors } from "../theme";
import type { Shift } from "../types";

/// Re-derives Online Stocks + Remaining Stock from a last-saved entry plus a
/// staged (not-yet-saved) diff on top of it - shared by the live grid
/// preview (usePendingEntryChanges' `recompute`, below) and validateImportRow's
/// advisory negative-stock pre-check, so the two never drift apart on what
/// "the new figures would be" actually means.
function computeOnlineFigures(entry: Record<string, unknown>, changes: Record<string, number>) {
  const openingStock = changes.openingStock ?? Number(entry.openingStock ?? 0);
  const stockInOffToOl = changes.stockInOffToOl ?? Number(entry.stockInOffToOl ?? 0);
  const stockOutOlToOff = changes.stockOutOlToOff ?? Number(entry.stockOutOlToOff ?? 0);
  const productionIn = changes.productionIn ?? Number(entry.productionIn ?? 0);
  const fulfillmentOut = changes.fulfillmentOut ?? Number(entry.fulfillmentOut ?? 0);
  const rts = changes.rts ?? Number(entry.rts ?? 0);

  const onlineStock = calculateOnlineStock(openingStock, stockInOffToOl, stockOutOlToOff);
  const remainingStock = calculateOnlineRemaining(onlineStock, productionIn, fulfillmentOut, rts);
  return { onlineStock, remainingStock };
}

export function OnlineEntryPage() {
  const { user } = useAuth();
  const progress = useTopProgress();
  // Defaults to whatever shift+date an encoder opening this page right now
  // is almost certainly working on (see getCurrentShiftAndDate) - date and
  // shift are picked together, not independently, since Night crosses
  // midnight and belongs to the *previous* calendar date after 12am.
  const [{ date, shift }, setDateShift] = useState(getCurrentShiftAndDate);
  const setDate = (d: string) => setDateShift((prev) => ({ ...prev, date: d }));
  const setShift = (s: Shift) => setDateShift((prev) => ({ ...prev, shift: s }));
  const [rows, setRows] = useState<GridRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [zoom, setZoom] = useZoom("online-entry");
  const [query, setQuery] = useState("");
  const [categoryFilter, setCategoryFilter] = useState("");
  const [saving, setSaving] = useState(false);
  const [showPreview, setShowPreview] = useState(false);
  const [showClearConfirm, setShowClearConfirm] = useState(false);
  // One level of Undo for the most recent Save - the pre-save value of
  // every field that batch touched, keyed the same way as pending edits.
  // Undoing re-submits those old values through the same save endpoint (so
  // it shows up in the Change Log like any other edit, not a silent
  // rewrite) and is itself one-shot: undoing clears this, it doesn't turn
  // into a redo stack.
  const [lastSavedBatch, setLastSavedBatch] = useState<PendingByProduct | null>(null);
  const [undoing, setUndoing] = useState(false);
  const canEdit = user?.role === "ONLINE_ENCODER" || user?.role === "SUPERVISOR_ADMIN";
  // So handleSaveAll (below) can tell CsvTools its own last import batch is
  // no longer just "pending" once a real Save has committed it - see
  // CsvTools' notifyCommitted doc comment.
  const csvToolsRef = useRef<CsvToolsHandle>(null);

  // Cell edits are staged here instead of hitting the save endpoint
  // immediately - Save (below) flushes them all at once, and Preview shows
  // exactly what's about to be submitted first (Section 3.1). Persisted to
  // sessionStorage under this date+shift's own key, so navigating to another
  // page and back - or just switching shift/date and back - doesn't lose an
  // edit still in progress.
  const { pending, displayRows, stage, clear, clearAll, pendingCount } = usePendingEntryChanges(
    rows,
    `ala-eh-pending:online:${date}:${shift}`,
    computeOnlineFigures,
  );

  // Search and the category dropdown only affect what's displayed in the
  // grid - both are local filters over the same already-loaded rows, not a
  // separate request per category.
  const categories = Array.from(new Set((rows ?? []).map((r) => r.product.category))).sort();
  const visibleRows = displayRows?.filter(
    (r) => matchesSearch([r.product.sku, r.product.name, r.product.category], query) && (categoryFilter === "" || r.product.category === categoryFilter),
  );

  useEffect(() => {
    setRows(null);
    // Pending edits aren't cleared here - usePendingEntryChanges re-derives
    // its own state from storage as soon as its date+shift-keyed storageKey
    // changes, so the shift being left keeps whatever it had staged (still
    // there if switched back to) and the one being loaded picks up whatever
    // it already had staged (if any), instead of both always starting empty.
    setLastSavedBatch(null); // Undo has no such persistence - it can only ever apply to the shift it was saved on
    getOnlineGrid(date, shift)
      .then((data) => setRows(data as unknown as GridRow[]))
      .catch((e) => setError(e.message));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [date, shift]);

  // Best-effort check of whether the *other* shift already has saved
  // entries for this date - surfaced as a banner below, so switching (or
  // auto-defaulting) across the 4pm/1am boundary doesn't silently open a
  // second, near-empty record when the shift that's actually still open
  // already has work in it. Never blocks the page if this call fails.
  const [otherShiftCount, setOtherShiftCount] = useState<number | null>(null);
  useEffect(() => {
    setOtherShiftCount(null);
    getOnlineGrid(date, otherShift(shift))
      .then((data) => setOtherShiftCount((data as unknown as GridRow[]).filter((r) => r.isSaved).length))
      .catch(() => setOtherShiftCount(null));
  }, [date, shift]);

  // Best-effort - CSV import's advisory negative-stock pre-check
  // (validateImportRow, below) needs the CURRENT shift's Offline rows to
  // predict whether a Stocks In/Out (Off<->Ol) change would push a
  // mirrored transfer negative on the Offline side. If this fails to load,
  // the pre-check just skips that one case rather than blocking anything.
  const [offlineRowsForImportCheck, setOfflineRowsForImportCheck] = useState<GridRow[] | null>(null);
  useEffect(() => {
    setOfflineRowsForImportCheck(null);
    getOfflineGrid(date, shift)
      .then((data) => setOfflineRowsForImportCheck(data as unknown as GridRow[]))
      .catch(() => setOfflineRowsForImportCheck(null));
  }, [date, shift]);

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

  // The save endpoint already returns the fully-recalculated row, so a
  // single edit only needs one round trip - merge that row into local state
  // instead of re-fetching all ~60 products' worth of grid data every time
  // a cell is committed.
  function mergeEntry(productId: number, saved: unknown) {
    setRows((prev) =>
      prev?.map((r) => (r.product.id === productId ? { ...r, entry: saved as unknown as typeof r.entry, isSaved: true } : r)) ?? prev
    );
  }

  // Stages the edit locally instead of saving immediately - see
  // usePendingEntryChanges. `rows` (not displayRows) is the source of the
  // last-saved value, so re-editing a cell back to its saved value still
  // correctly drops it from the pending set.
  function handleCommit(productId: number, key: string, value: number) {
    const savedValue = Number(rows?.find((r) => r.product.id === productId)?.entry[key] ?? 0);
    stage(productId, key, value, savedValue);
  }

  // Flushes every staged product's changes in one pass - each product is
  // still its own request (the endpoint is per-product/date, same as a
  // manual edit or a CSV import row), but the user only triggers this once
  // for however many cells they've touched. Returns whether every staged
  // change actually saved - handlePrintConfirm (below) needs that to know
  // whether it's safe to let a "Save & Print" through.
  async function handleSaveAll(): Promise<boolean> {
    setError(null);
    setSaving(true);
    // Real per-item progress (Section: Loading system) - same pattern
    // CsvTools' own import Save already uses. Particularly worth it here:
    // a bulk CSV import can stage dozens of products at once, so this can be
    // a genuinely long sequential save, not the near-instant single-cell
    // edit this button started out handling.
    progress.start();
    const failed: string[] = [];
    const revertTo: PendingByProduct = {};
    const entries = Object.entries(pending);
    for (let i = 0; i < entries.length; i++) {
      const [productIdStr, changes] = entries[i];
      const productId = Number(productIdStr);
      // Snapshot each field's pre-save value before overwriting it, so
      // Undo has something to put back - taken from `rows` (last-saved
      // truth), same source handleCommit uses to decide what counts as
      // "changed" in the first place.
      const priorRow = rows?.find((r) => r.product.id === productId);
      const oldValues: Record<string, number> = {};
      for (const key of Object.keys(changes)) oldValues[key] = Number(priorRow?.entry[key] ?? 0);

      try {
        const saved = await saveOnlineEntry(productId, date, shift, changes);
        mergeEntry(productId, saved);
        clear(productId);
        revertTo[productId] = oldValues;
      } catch (e) {
        const name = priorRow?.product.name ?? `#${productId}`;
        // The server's own message (e.g. the negative-stock guard's "would
        // end at -5") is the actual reason - without it, every failure looks
        // identical ("still shown as unsaved, try Save again.") no matter
        // what actually went wrong, leaving nothing to act on.
        const reason = e instanceof Error ? e.message : "unknown error";
        failed.push(`${name} (${reason})`);
      }
      progress.set(Math.round(((i + 1) / entries.length) * 100));
    }
    setSaving(false);
    setShowPreview(false);
    if (Object.keys(revertTo).length > 0) setLastSavedBatch(revertTo);
    if (failed.length) {
      setError(`Failed to save: ${failed.join("; ")}`);
      progress.fail();
    } else {
      progress.done();
    }
    // Whatever CsvTools' own "Undo Import" batch might still reference is no
    // longer just staged - some or all of it just got committed for real by
    // this Save (see CsvTools' notifyCommitted doc comment). Safe to call
    // even when nothing was actually imported - it's a no-op then.
    csvToolsRef.current?.notifyCommitted();
    return failed.length === 0;
  }

  // Discards every currently-staged edit (manual or imported) without
  // saving any of it - the counterpart to Save for "actually I don't want
  // any of this", so an encoder doesn't have to hand-revert each cell (or
  // reload the page and lose the sessionStorage-persisted draft some other
  // way). Never touches the server - there's nothing to undo once this
  // runs, unlike handleUndoLastSave.
  function handleClearAll() {
    clearAll();
    setShowClearConfirm(false);
    // Same reasoning as handleSaveAll's own call: a cleared pending set can
    // no longer be reverted, so CsvTools' "Undo Import" toast must stop
    // offering to.
    csvToolsRef.current?.notifyCommitted();
  }

  // CSV import (Section 3.1) stages every column it touched exactly like a
  // manual cell edit - it used to write straight through to the save
  // endpoint the instant a row was parsed, which meant an imported file's
  // numbers (and anything mirrored/recalculated from them, like the Offline
  // table or the calculated Online/Remaining Stock columns) went live across
  // the system before the user ever got a chance to review or save. Routing
  // it through `stage` means Save is the same explicit, previewable step for
  // an import as it already is for a typed edit.
  async function handleImportRow(productId: number, values: Record<string, number>) {
    const savedRow = rows?.find((r) => r.product.id === productId);
    for (const [key, value] of Object.entries(values)) {
      stage(productId, key, value, Number(savedRow?.entry[key] ?? 0));
    }
  }

  // Advisory-only pre-check for CsvTools' Review modal (Option 1 from the
  // "flagged import" discussion): mirrors the server's own negative-stock
  // guard and its Online->Offline transfer mirror, using client-side copies
  // of the same pure formulas (utils/stockMath.ts) - purely to warn before
  // Save, never to block it. The server remains the only real enforcement;
  // this can be wrong (stale data, a concurrent edit) without any real risk,
  // since Save always re-checks for real.
  function validateImportRow(productId: number, changes: Record<string, number>): string | undefined {
    const row = rows?.find((r) => r.product.id === productId);
    if (!row) return undefined;
    const entry = row.entry as unknown as Record<string, unknown>;

    const stockInOffToOl = changes.stockInOffToOl ?? Number(entry.stockInOffToOl ?? 0);
    const stockOutOlToOff = changes.stockOutOlToOff ?? Number(entry.stockOutOlToOff ?? 0);
    const { remainingStock } = computeOnlineFigures(entry, changes);
    if (isNegativeStock(remainingStock)) {
      return `This would take ${row.product.name}'s Online stock below zero (would end at ${remainingStock}).`;
    }

    // Only relevant when the transfer fields themselves changed - an edit
    // to, say, Fulfillment (Out) alone never touches the Offline side.
    if (changes.stockInOffToOl !== undefined || changes.stockOutOlToOff !== undefined) {
      const offlineRow = offlineRowsForImportCheck?.find((r) => r.product.id === productId);
      if (offlineRow) {
        const offlineEntry = offlineRow.entry as unknown as Record<string, unknown>;
        // Same mapping as mirrorTransferToOffline (dailyOnlineStock.service.ts):
        // Online's stockInOffToOl becomes Offline's stockOutOffToOl, and
        // Online's stockOutOlToOff becomes Offline's stockInOlToOff.
        const offlineStock = calculateOfflineStock(Number(offlineEntry.openingStock ?? 0), stockOutOlToOff, stockInOffToOl);
        const offlineRemaining = calculateOfflineRemaining(
          offlineStock,
          Number(offlineEntry.productionIn ?? 0),
          Number(offlineEntry.deliveryOut ?? 0),
          Number(offlineEntry.backloads ?? 0),
          Number(offlineEntry.upsellOut ?? 0),
        );
        if (isNegativeStock(offlineRemaining)) {
          return `This transfer would take ${row.product.name}'s Offline stock below zero (would end at ${offlineRemaining}).`;
        }
      }
    }

    return undefined;
  }

  // Re-submits the pre-save values captured above through the same save
  // endpoint - an undo is its own tracked edit (shows up in the Change Log
  // like any other save), not a silent rewrite of history. One level only:
  // undoing consumes lastSavedBatch rather than pushing onto a redo stack.
  async function handleUndoLastSave() {
    if (!lastSavedBatch) return;
    setError(null);
    setUndoing(true);
    const failed: string[] = [];
    for (const [productIdStr, oldValues] of Object.entries(lastSavedBatch)) {
      const productId = Number(productIdStr);
      try {
        const saved = await saveOnlineEntry(productId, date, shift, oldValues);
        mergeEntry(productId, saved);
      } catch (e) {
        const name = rows?.find((r) => r.product.id === productId)?.product.name ?? `#${productId}`;
        const reason = e instanceof Error ? e.message : "unknown error";
        failed.push(`${name} (${reason})`);
      }
    }
    setUndoing(false);
    setLastSavedBatch(null);
    if (failed.length) setError(`Failed to undo: ${failed.join("; ")}`);
  }

  // PDF of the grid as currently filtered (search / category), with every
  // category fully listed. Built from the row data by utils/tablePdf.ts - not
  // by printing the page - so the layout is the same on every page and
  // always fits the paper. Disabled while edits are unsaved (see the button).
  async function handlePdf() {
    if (!visibleRows) return;
    try {
      await progress.track(() =>
        downloadTablePdf({
          filename: pdfFileName("online-stock", date, shift),
          title: "Daily Online Stock Monitoring",
          subtitle: `${formatDateDisplay(date)} - ${SHIFT_SHORT_LABELS[shift]} Shift`,
          notes: filterNotes({ category: categoryFilter, query }),
          sections: [stockGridSection(visibleRows, columns)],
        }),
      );
    } catch (e) {
      setError(e instanceof Error ? `PDF failed: ${e.message}` : "PDF failed");
    }
  }

  return (
    <div>
      <PageHeader
        title={`Daily Online Stock Monitoring - ${formatDateDisplay(date)} - ${SHIFT_SHORT_LABELS[shift]} Shift`}
        subtitle="Stocks In/Out transfers entered here mirror automatically onto the Offline table."
      >
      <Toolbar className="no-print ae-toolbar-entry">
        <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "nowrap", minWidth: 0 }}>
          {canEdit && (
            <Button
              type="button"
              variant="secondary"
              size="sm"
              onClick={handleUndoLastSave}
              disabled={!lastSavedBatch || undoing}
              aria-label="Undo last save"
              title="Undo last save"
              className="ae-tap-target"
              style={{ width: 30, height: 30, padding: 0, display: "inline-flex", alignItems: "center", justifyContent: "center" }}
            >
              <UndoIcon />
            </Button>
          )}
          <SearchInput value={query} onChange={setQuery} placeholder="Search SKU or category…" />
          <CategoryFilter categories={categories} value={categoryFilter} onChange={setCategoryFilter} />
          <DatePicker aria-label="Date" value={date} onChange={setDate} todayValue={getCurrentShiftAndDate().date} style={{ maxWidth: 180 }} />
          <ShiftFilter value={shift} onChange={(s) => s && setShift(s)} />
        </div>
        <ToolbarControls>
          {canEdit && (
            <Button className="ae-toolbar-save" type="button" variant="secondary" size="sm" onClick={() => setShowPreview(true)} disabled={pendingCount === 0} title="Review and save changes">
              <SaveIcon />
              <span className="ae-toolbar-btn-label">Save{pendingCount > 0 ? ` (${pendingCount})` : ""}</span>
            </Button>
          )}
          {canEdit && (
            <Button
              className="ae-toolbar-save"
              type="button"
              variant="secondary"
              size="sm"
              onClick={() => setShowClearConfirm(true)}
              disabled={pendingCount === 0 || saving}
              title="Discard unsaved changes on this sheet"
            >
              <ClearIcon />
              <span className="ae-toolbar-btn-label">Clear</span>
            </Button>
          )}
          <Button
            className="ae-toolbar-save"
            type="button"
            variant="secondary"
            size="sm"
            onClick={handlePdf}
            disabled={pendingCount > 0 || !visibleRows}
            title={pendingCount > 0 ? "Save your changes first - PDF reflects only saved data" : "Download as PDF"}
          >
            <PrinterIcon />
            <span className="ae-toolbar-btn-label">PDF</span>
          </Button>
          {canEdit && rows && (
            <CsvTools
              ref={csvToolsRef}
              filenamePrefix="online-entry"
              date={date}
              rows={rows}
              columns={columns}
              onImportRow={handleImportRow}
              getPendingValue={(productId, key) => pending[productId]?.[key]}
              validateImport={validateImportRow}
              canImport
              showExport={false}
              showPdf={false}
            />
          )}
          <ZoomControl zoom={zoom} onChange={setZoom} />
        </ToolbarControls>
      </Toolbar>
      </PageHeader>
      {otherShiftCount !== null && otherShiftCount > 0 && (
        <p style={{ fontSize: 12, color: colors.warningText, margin: "0 0 8px" }}>
          ⚠ {SHIFT_LABELS[otherShift(shift)]} already has {otherShiftCount} saved entr{otherShiftCount === 1 ? "y" : "ies"} for {date} - double-check you're on the right shift before entering data.
        </p>
      )}
      {error && <p style={{ color: colors.danger }}>{error}</p>}
      {!rows ? (
        <TableSkeleton
          headers={["SKU", "Product", ...columns.map((c) => c.label)]}
          minWidth={720}
          label="Loading online entries…"
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
            columns={columns}
            onCommit={handleCommit}
            readOnly={!canEdit}
            pending={pending}
            focusStorageKey={`ala-eh-focus:online:${date}:${shift}`}
          />
        </div>
      )}
      {!canEdit && <p style={{ fontSize: 12, color: colors.subtleInk, marginTop: 8 }}>Read-only: your role can view but not edit Online entries.</p>}
      {showPreview && (
        <Modal title="Unsaved changes" onClose={() => setShowPreview(false)}>
          <PendingChangesPreview items={describePendingChanges(rows, pending, columns)} />
          <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 16 }}>
            <Button type="button" variant="secondary" size="sm" onClick={() => setShowPreview(false)}>
              Keep editing
            </Button>
            <Button type="button" size="sm" onClick={handleSaveAll} disabled={pendingCount === 0 || saving}>
              {saving ? "Saving…" : `Save (${pendingCount})`}
            </Button>
          </div>
        </Modal>
      )}
      {showClearConfirm && (
        <Modal title="Discard unsaved changes?" onClose={() => setShowClearConfirm(false)}>
          <PendingChangesPreview items={describePendingChanges(rows, pending, columns)} />
          <p style={{ margin: "12px 0 0", fontSize: 12.5, color: colors.subtleInk }}>
            This clears every unsaved edit on this sheet (typed or imported) - nothing has been saved yet, so nothing on the server is affected.
          </p>
          <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 16 }}>
            <Button type="button" variant="secondary" size="sm" onClick={() => setShowClearConfirm(false)}>
              Keep editing
            </Button>
            <Button type="button" variant="danger" size="sm" onClick={handleClearAll}>
              Discard {pendingCount}
            </Button>
          </div>
        </Modal>
      )}
      {saving && <LoadingOverlay label="Saving changes…" />}
    </div>
  );
}