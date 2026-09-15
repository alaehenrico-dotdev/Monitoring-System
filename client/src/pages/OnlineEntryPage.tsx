import { useEffect, useState } from "react";
import { StockGrid, type GridRow } from "../components/StockGrid";
import { getOnlineGrid, saveOnlineEntry } from "../api/onlineStock";
import { useAuth } from "../context/AuthContext";
import { Button, TextInput } from "../components/ui";
import { useZoom, zoomStyle, ZoomControl } from "../components/ZoomControl";
import { Toolbar, ToolbarControls } from "../components/Toolbar";
import { PrinterIcon, UndoIcon } from "../components/icons";
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

  // Search only affects what's displayed in the grid.
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

  return (
    <div>
      <h2 style={{ margin: "-8px 0 0px" }}>Daily Online Stock Monitoring - {formatDateDisplay(date)}</h2>
      <p style={{ fontSize: 13, color: colors.subtleInk, margin: "0 0 8px" }}>
        Stocks In/Out transfers entered here mirror automatically onto the Offline table (Section 4.3).
      </p>
      <Toolbar className="no-print ae-toolbar-entry">
        <div style={{ display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
          {canEdit && (
            <Button
              type="button"
              variant="secondary"
              size="sm"
              onClick={handleUndoLastSave}
              disabled={!lastSavedBatch || undoing}
              aria-label="Undo last save"
              title="Undo last save"
              style={{ width: 30, height: 30, padding: 0, display: "inline-flex", alignItems: "center", justifyContent: "center" }}
            >
              <UndoIcon />
            </Button>
          )}
          <SearchInput value={query} onChange={setQuery} placeholder="Search product or category…" />
          <TextInput type="date" aria-label="Date" value={date} onChange={(e) => setDate(e.target.value)} style={{ maxWidth: 180 }} />
        </div>
        <ToolbarControls>
          {canEdit && (
            <Button className="ae-toolbar-save" type="button" variant="secondary" size="sm" onClick={() => setShowPreview(true)} disabled={pendingCount === 0} title="Review and save changes">
              Save{pendingCount > 0 ? ` (${pendingCount})` : ""}
            </Button>
          )}
          <Button className="ae-toolbar-save" type="button" variant="secondary" size="sm" onClick={() => window.print()} title="Print or save as PDF">
            <PrinterIcon /> PDF
          </Button>
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
    </div>
  );
}
