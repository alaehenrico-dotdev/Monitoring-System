import { useEffect, useState, type CSSProperties } from "react";
import { AnimatePresence, motion } from "motion/react";
import { getManualCountGrid, saveManualCount } from "../api/manualCounts";
import type { ManualCountGridRow, StockLocation } from "../types";
import { Button, Select, TextInput } from "../components/ui";
import { useZoom, zoomStyle, ZoomControl } from "../components/ZoomControl";
import { CsvTools } from "../components/CsvTools";
import { Toolbar, ToolbarControls, ToolbarDivider } from "../components/Toolbar";
import { SearchInput } from "../components/SearchInput";
import { CategoryFilter } from "../components/CategoryFilter";
import { SaveIcon } from "../components/icons";
import { Modal } from "../components/Modal";
import { matchesSearch } from "../utils/search";
import { formatDateDisplay } from "../utils/dateFormat";
import { toolbarLayoutTransition } from "../motion";
import { colors } from "../theme";
import { RowGlowScroll } from "../components/RowGlowScroll";

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

const LOCATIONS: StockLocation[] = ["ONLINE", "OFFLINE", "TOTAL"];

const csvColumns = [
  { key: "systemRemainingStock", label: "System Remaining" },
  { key: "manualCount", label: "Manual Count" },
  { key: "variance", label: "Variance" },
];

/// Section 4.4 - the supervisor (or encoder on duty) enters the physical
/// count; Variance = System Remaining Stock - Manual Count is always
/// system-calculated, never typed directly.
export function ManualCountPage() {
  const [date, setDate] = useState(today());
  const [location, setLocation] = useState<StockLocation>("ONLINE");
  const [rows, setRows] = useState<ManualCountGridRow[] | null>(null);
  const [drafts, setDrafts] = useState<Record<number, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [zoom, setZoom] = useZoom("manual-count");
  const [query, setQuery] = useState("");
  const [categoryFilter, setCategoryFilter] = useState("");
  const [saving, setSaving] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);

  function load() {
    setRows(null);
    setDrafts({});
    getManualCountGrid(date, location)
      .then(setRows)
      .catch((e) => setError(e.message));
  }

  useEffect(load, [date, location]);

  // Warn before navigating/closing the tab with staged-but-unsaved counts -
  // same guard as Online/Offline Entry, now that a typed count no longer
  // saves on blur.
  useEffect(() => {
    if (Object.keys(drafts).length === 0) return;
    function onBeforeUnload(e: BeforeUnloadEvent) {
      e.preventDefault();
    }
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, [drafts]);

  // Typing a count only stages a local draft (see the input's onChange
  // below) - it no longer saves on blur. Save opens a quick confirm step
  // (below) listing exactly what's about to be written, then this flushes
  // every staged count in one pass, same "per-product save endpoint"
  // pattern as Online/Offline Entry. PDF stays disabled the whole time a
  // draft is unsaved (see pdfDisabled on CsvTools below), so a printed
  // sheet can never show a count that was typed but never actually
  // persisted.
  async function handleSaveAll() {
    setError(null);
    setSaving(true);
    const failed: string[] = [];
    const succeeded: number[] = [];
    for (const [productIdStr, draft] of Object.entries(drafts)) {
      const productId = Number(productIdStr);
      if (draft === "") {
        succeeded.push(productId);
        continue;
      }
      try {
        const saved = await saveManualCount(productId, date, location, Number(draft));
        // Merge the recalculated row (system remaining stock + variance) in
        // directly instead of re-fetching the whole grid for one edit.
        setRows((prev) =>
          prev?.map((r) => (r.product.id === productId ? { ...r, entry: saved, isSaved: true, isFlagged: Number(saved.variance) !== 0 } : r)) ??
          prev
        );
        succeeded.push(productId);
      } catch (e) {
        const name = rows?.find((r) => r.product.id === productId)?.product.name ?? `#${productId}`;
        failed.push(name);
      }
    }
    setDrafts((d) => {
      const next = { ...d };
      for (const id of succeeded) delete next[id];
      return next;
    });
    setSaving(false);
    setShowConfirm(false);
    if (failed.length) setError(`Failed to save: ${failed.join(", ")} - still unsaved, try Save again.`);
  }

  const pendingCount = Object.keys(drafts).length;
  // What the confirm modal lists - one row per staged (non-blank) draft,
  // resolved against the last-loaded rows for the product name/old count.
  const pendingChanges = Object.entries(drafts)
    .filter(([, draft]) => draft !== "")
    .map(([productIdStr, draft]) => {
      const productId = Number(productIdStr);
      const row = rows?.find((r) => r.product.id === productId);
      return { productId, name: row?.product.name ?? `#${productId}`, oldValue: row?.entry.manualCount ?? "—", newValue: draft };
    });
  const flaggedCount = rows?.filter((r) => r.isFlagged).length ?? 0;

  // Nulls (not yet counted) export as blank cells rather than "0", which
  // would misleadingly read as a confirmed zero count.
  const csvRows = rows?.map((r) => ({
    product: r.product,
    entry: {
      systemRemainingStock: r.entry.systemRemainingStock,
      manualCount: r.entry.manualCount ?? "",
      variance: r.entry.variance ?? "",
    },
  }));

  const categories = Array.from(new Set((rows ?? []).map((r) => r.product.category))).sort();
  const visibleRows = rows?.filter(
    (r) => matchesSearch([r.product.name, r.product.category], query) && (categoryFilter === "" || r.product.category === categoryFilter),
  );

  return (
    <div>
      <h2 style={{ margin: "-8px 0 0px" }}>Manual Counting &amp; Variance - {formatDateDisplay(date)}</h2>
      <p style={{ fontSize: 13, color: colors.subtleInk, margin: "0 0 8px" }}>
        Review and correct manual counts for the selected date.
      </p>
      <Toolbar className="no-print">
        {/* `layout` - matches ToolbarControls (Toolbar.tsx) on the other
            side of this row. Without it, this cluster doesn't react when
            the flagged-count badge mounts/unmounts or its own label
            collapses in compact mode, so the other controls in it would
            jump sideways instead of sliding smoothly. */}
        <motion.div layout transition={toolbarLayoutTransition} style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "nowrap", minWidth: 0 }}>
          <TextInput type="date" aria-label="Date" value={date} onChange={(e) => setDate(e.target.value)} />
          <Select aria-label="Location" value={location} onChange={(e) => setLocation(e.target.value as StockLocation)}>
            {LOCATIONS.map((l) => (
              <option key={l} value={l}>
                {l}
              </option>
            ))}
          </Select>
          <SearchInput value={query} onChange={setQuery} placeholder="Search SKU or category…" />
          <CategoryFilter categories={categories} value={categoryFilter} onChange={setCategoryFilter} />
          <AnimatePresence initial={false}>
            {flaggedCount > 0 && (
              <motion.span
                layout
                initial={{ opacity: 0, scale: 0.8 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.8 }}
                transition={toolbarLayoutTransition}
                style={{ color: colors.warningText, fontSize: 13, fontWeight: 600, whiteSpace: "nowrap", flexShrink: 0 }}
                title={`${flaggedCount} product(s) with a non-zero variance`}
              >
                {/* The " flagged" word reuses .ae-toolbar-btn-label (index.css)
                    - the same collapsible label every other toolbar control's
                    text uses, so this badge shrinks to a bare "⚠ N" in
                    compact mode instead of being the one control left un-
                    handled by that pattern, at risk of getting clipped by
                    .ae-toolbar--compact's overflow:hidden instead. */}
                ⚠ {flaggedCount}
                <span className="ae-toolbar-btn-label"> flagged</span>
              </motion.span>
            )}
          </AnimatePresence>
        </motion.div>
        <ToolbarControls>
          <Button
            className="ae-toolbar-save"
            type="button"
            variant="secondary"
            size="sm"
            onClick={() => setShowConfirm(true)}
            disabled={pendingCount === 0 || saving}
            title="Review and save changes"
          >
            <SaveIcon />
            <span className="ae-toolbar-btn-label">{saving ? "Saving…" : `Save${pendingCount > 0 ? ` (${pendingCount})` : ""}`}</span>
          </Button>
          {csvRows && (
            <>
              <CsvTools
                filenamePrefix={`manual-count-${location.toLowerCase()}`}
                date={date}
                rows={csvRows}
                columns={csvColumns}
                onImportRow={async () => {}}
                canImport={false}
                pdfDisabled={pendingCount > 0}
              />
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
          {/* Same containment as StockGrid: the scrollbar belongs to this
              inner wrapper, not the page - at high zoom the table scrolls
              sideways in place instead of pushing the whole page (heading,
              date/location fields) off to the right. */}
          <RowGlowScroll>
            <table className="ae-table" style={{ minWidth: 640 }}>
              <thead>
                <tr>
                  {["Category", "SKU", "System Remaining", "Manual Count", "Variance"].map((h) => (
                    <th key={h}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {(visibleRows ?? []).map((r) => (
                  <tr key={r.product.id} style={r.isFlagged ? { background: colors.warningBg } : undefined}>
                    <td style={nameCellStyle}>{r.product.category}</td>
                    <td style={nameCellStyle}>{r.product.name}</td>
                    {/* Prisma Decimal fields serialize as JSON strings once a row is
                        persisted (unlike the plain-number preview shown before a
                        row is saved), so this is wrapped in Number() rather than
                        relying on .toLocaleString() alone - a bare string's
                        .toLocaleString() is a silent no-op, not a crash, but it
                        would drop thousands-separator formatting on saved rows. */}
                    <td>{Number(r.entry.systemRemainingStock).toLocaleString()}</td>
                    <td>
                      <input
                        className="ae-input ae-input-cell"
                        type="number"
                        value={drafts[r.product.id] ?? r.entry.manualCount ?? ""}
                        onChange={(e) => setDrafts((d) => ({ ...d, [r.product.id]: e.target.value }))}
                        onKeyDown={(e) => e.key === "Enter" && (e.currentTarget as HTMLInputElement).blur()}
                        style={{ width: 64, textAlign: "right" }}
                      />
                    </td>
                    <td style={{ fontWeight: r.isFlagged ? 700 : 400 }}>{r.entry.variance ?? "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </RowGlowScroll>
        </div>
      )}
      {showConfirm && (
        <Modal title="Confirm manual counts" onClose={() => setShowConfirm(false)}>
          {pendingChanges.length === 0 ? (
            <p style={{ margin: 0, color: colors.subtleInk, fontSize: 13 }}>No unsaved changes.</p>
          ) : (
            <table className="ae-table" style={{ minWidth: 0 }}>
              <thead>
                <tr>
                  <th>SKU</th>
                  <th>Old count</th>
                  <th>New count</th>
                </tr>
              </thead>
              <tbody>
                {pendingChanges.map((c) => (
                  <tr key={c.productId}>
                    <td style={{ textAlign: "left" }}>{c.name}</td>
                    <td>{c.oldValue}</td>
                    <td style={{ fontWeight: 700, color: colors.red }}>{c.newValue}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 16 }}>
            <Button type="button" variant="secondary" size="sm" onClick={() => setShowConfirm(false)}>
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

const nameCellStyle: CSSProperties = { textAlign: "left", whiteSpace: "nowrap" };