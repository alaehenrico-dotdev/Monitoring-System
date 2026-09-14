import { useEffect, useState } from "react";
import { StockGrid, type GridRow } from "../components/StockGrid";
import { getOnlineGrid, saveOnlineEntry } from "../api/onlineStock";
import { useAuth } from "../context/AuthContext";
import { Button, TextInput } from "../components/ui";
import { useZoom, zoomStyle, ZoomControl } from "../components/ZoomControl";
import { CsvTools } from "../components/CsvTools";
import { Toolbar, ToolbarControls, ToolbarDivider } from "../components/Toolbar";
import { SearchInput } from "../components/SearchInput";
import { Modal } from "../components/Modal";
import { PendingChangesPreview } from "../components/PendingChangesPreview";
import { describePendingChanges, usePendingEntryChanges, type PendingByProduct } from "../hooks/usePendingEntryChanges";
import { onlineStockColumns as columns } from "../config/stockColumns";
import { matchesSearch } from "../utils/search";
import { formatDateDisplay } from "../utils/dateFormat";
import { colors } from "../theme";

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

export function OnlineEntryPage() {
  const { user } = useAuth();
  const [date, setDate] = useState(today());
  const [rows, setRows] = useState<GridRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [zoom, setZoom] = useZoom("online-entry");
  const [query, setQuery] = useState("");
  const [saving, setSaving] = useState(false);
  const [showPreview, setShowPreview] = useState(false);
  // One level of Undo for the most recent Save - the pre-save value of
  // every field that batch touched, keyed the same way as pending edits.
  // Undoing re-submits those old values through the same save endpoint (so
  // it shows up in the Change Log like any other edit, not a silent
  // rewrite) and is itself one-shot: undoing clears this, it doesn't turn
  // into a redo stack.
  const [lastSavedBatch, setLastSavedBatch] = useState<PendingByProduct | null>(null);
  const [undoing, setUndoing] = useState(false);
  const canEdit = user?.role === "ONLINE_ENCODER" || user?.role === "SUPERVISOR_ADMIN";

  // Cell edits are staged here instead of hitting the save endpoint
  // immediately - Save (below) flushes them all at once, and Preview shows
  // exactly what's about to be submitted first (Section 3.1).
  const { pending, displayRows, stage, clear, clearAll, pendingCount } = usePendingEntryChanges(rows);

  // Search only affects what's displayed in the grid - CsvTools keeps
  // working off the full, unfiltered `rows` so import-matching and export
  // still cover every product regardless of the current search text.
  const visibleRows = displayRows?.filter((r) => matchesSearch([r.product.name, r.product.category], query));

  useEffect(() => {
    setRows(null);
    clearAll(); // pending edits belong to the date being left, not the one being loaded
    setLastSavedBatch(null); // ditto for Undo - it can only ever apply to the date it was saved on
    getOnlineGrid(date)
      .then((data) => setRows(data as unknown as GridRow[]))
      .catch((e) => setError(e.message));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [date]);

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
    const failed: string[] = [];
    const revertTo: PendingByProduct = {};
    for (const [productIdStr, changes] of Object.entries(pending)) {
      const productId = Number(productIdStr);
      // Snapshot each field's pre-save value before overwriting it, so
      // Undo has something to put back - taken from `rows` (last-saved
      // truth), same source handleCommit uses to decide what counts as
      // "changed" in the first place.
      const priorRow = rows?.find((r) => r.product.id === productId);
      const oldValues: Record<string, number> = {};
      for (const key of Object.keys(changes)) oldValues[key] = Number(priorRow?.entry[key] ?? 0);

      try {
        const saved = await saveOnlineEntry(productId, date, changes);
        mergeEntry(productId, saved);
        clear(productId);
        revertTo[productId] = oldValues;
      } catch (e) {
        const name = priorRow?.product.name ?? `#${productId}`;
        failed.push(name);
      }
    }
    setSaving(false);
    setShowPreview(false);
    if (Object.keys(revertTo).length > 0) setLastSavedBatch(revertTo);
    if (failed.length) setError(`Failed to save: ${failed.join(", ")} - still shown as unsaved, try Save again.`);
    return failed.length === 0;
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
        const saved = await saveOnlineEntry(productId, date, oldValues);
        mergeEntry(productId, saved);
      } catch (e) {
        const name = rows?.find((r) => r.product.id === productId)?.product.name ?? `#${productId}`;
        failed.push(name);
      }
    }
    setUndoing(false);
    setLastSavedBatch(null);
    if (failed.length) setError(`Failed to undo: ${failed.join(", ")}.`);
  }

  // PDF export just prints the current page, which would otherwise silently
  // include cells that are only staged locally and were never actually
  // saved - this pauses that print behind a confirmation whenever there's
  // anything still unsaved (see CsvTools' onBeforePrint), resolved once the
  // user picks Save & Print / Print Anyway / Cancel in the modal below.
  const [printConfirmResolve, setPrintConfirmResolve] = useState<((proceed: boolean) => void) | null>(null);

  function handleBeforePrint(): Promise<boolean> {
    if (pendingCount === 0) return Promise.resolve(true);
    return new Promise<boolean>((resolve) => setPrintConfirmResolve(() => resolve));
  }

  function resolvePrintConfirm(proceed: boolean) {
    printConfirmResolve?.(proceed);
    setPrintConfirmResolve(null);
  }

  async function handleSaveThenPrint() {
    resolvePrintConfirm(await handleSaveAll());
  }

  // CSV import applies every editable column present in the file for one
  // product/date in a single request, then merges the result exactly like a
  // manual cell edit would (Section 3.1 - bulk correction via a spreadsheet
  // file instead of retyping cell by cell). Bypasses the staging above and
  // saves immediately - it's already a deliberate, reviewed bulk action of
  // its own (the file itself is the "preview"), not a cell someone is still
  // in the middle of typing.
  async function handleImportRow(productId: number, values: Record<string, number>) {
    const saved = await saveOnlineEntry(productId, date, values);
    mergeEntry(productId, saved);
  }

  return (
    <div>
      <h2 style={{ margin: "0 0 3px" }}>Daily Online Stock Monitoring - {formatDateDisplay(date)}</h2>
      <p style={{ fontSize: 13, color: colors.subtleInk, margin: "0 0 8px" }}>
        Stocks In/Out transfers entered here mirror automatically onto the Offline table (Section 4.3).
      </p>
      <Toolbar className="no-print">
        <div style={{ display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
          <TextInput type="date" aria-label="Date" value={date} onChange={(e) => setDate(e.target.value)} style={{ maxWidth: 180 }} />
          {canEdit && (
            <Button
              type="button"
              variant="secondary"
              size="sm"
              onClick={handleUndoLastSave}
              disabled={!lastSavedBatch || undoing}
              title="Revert the changes from your last Save"
            >
              {undoing ? "Undoing…" : "Undo"}
            </Button>
          )}
          <SearchInput value={query} onChange={setQuery} placeholder="Search product or category…" />
        </div>
        <ToolbarControls>
          {rows && (
            <>
              <CsvTools
                filenamePrefix="online-stock"
                date={date}
                rows={rows}
                columns={columns}
                onImportRow={handleImportRow}
                canImport={canEdit}
                onBeforePrint={handleBeforePrint}
              />
              <ToolbarDivider />
            </>
          )}
          {canEdit && (
            <>
              <Button
                type="button"
                variant="secondary"
                size="sm"
                onClick={() => setShowPreview(true)}
                disabled={pendingCount === 0}
                title="Review unsaved changes before saving"
              >
                Preview{pendingCount > 0 ? ` (${pendingCount})` : ""}
              </Button>
              <Button
                type="button"
                size="sm"
                onClick={handleSaveAll}
                disabled={pendingCount === 0 || saving}
                title="Save every unsaved change"
              >
                {saving ? "Saving…" : `Save${pendingCount > 0 ? ` (${pendingCount})` : ""}`}
              </Button>
              <ToolbarDivider />
            </>
          )}
          <ZoomControl zoom={zoom} onChange={setZoom} />
        </ToolbarControls>
      </Toolbar>
      {error && <p style={{ color: colors.danger }}>{error}</p>}
      {!rows ? (
        <p>Loading…</p>
      ) : (
        <div className="ae-grid-fill" style={zoomStyle(zoom)}>
          <StockGrid rows={visibleRows ?? []} columns={columns} onCommit={handleCommit} readOnly={!canEdit} />
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
      {printConfirmResolve && (
        <Modal title="Unsaved changes" onClose={() => resolvePrintConfirm(false)}>
          <p style={{ marginTop: 0 }}>
            You have {pendingCount} unsaved change{pendingCount === 1 ? "" : "s"}. The PDF will reflect exactly what's on
            screen either way (including any unsaved edits) - Save first if you want those durably recorded too, not just
            printed.
          </p>
          <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 16, flexWrap: "wrap" }}>
            <Button type="button" variant="secondary" size="sm" onClick={() => resolvePrintConfirm(false)}>
              Cancel
            </Button>
            <Button type="button" variant="secondary" size="sm" onClick={() => resolvePrintConfirm(true)}>
              Print anyway
            </Button>
            <Button type="button" size="sm" onClick={handleSaveThenPrint} disabled={saving}>
              {saving ? "Saving…" : "Save & Print"}
            </Button>
          </div>
        </Modal>
      )}
    </div>
  );
}
