import { Fragment, useEffect, useState, type CSSProperties } from "react";
import { getManualCountGrid, saveManualCount } from "../api/manualCounts";
import type { ManualCountGridRow, StockLocation } from "../types";
import { Button, NumberCellInput } from "../components/ui";
import { Dropdown } from "../components/Dropdown";
import { DatePicker } from "../components/DatePicker";
import { useZoom, zoomStyle, ZoomControl } from "../components/ZoomControl";
import { CsvTools } from "../components/CsvTools";
import {
  Toolbar,
  ToolbarControls,
  ToolbarDivider,
} from "../components/Toolbar";
import { PageHeader } from "../components/PageHeader";
import { SearchInput } from "../components/SearchInput";
import { CategoryFilter } from "../components/CategoryFilter";
import { ShiftFilter } from "../components/ShiftFilter";
import { ChevronIcon, SaveIcon } from "../components/icons";
import { Modal } from "../components/Modal";
import { matchesSearch } from "../utils/search";
import { formatDateDisplay } from "../utils/dateFormat";
import { getCurrentShiftAndDate, SHIFT_SHORT_LABELS } from "../utils/shift";
import { colors } from "../theme";
import { RowGlowScroll } from "../components/RowGlowScroll";
import { TableSkeleton } from "../components/Skeleton";
import type { Shift } from "../types";

const LOCATIONS: StockLocation[] = ["ONLINE", "OFFLINE", "TOTAL"];

const csvColumns = [
  // System-computed - never imported (see this page's own doc comment: "...
  // is always system-calculated, never typed directly").
  { key: "systemRemainingStock", label: "System Remaining" },
  // The real monthly report (Section 8.1) headers this column "MANUAL
  // COUNTING", not "Manual Count" - a genuine wording difference (not just
  // case/punctuation), same reasoning as stockColumns.ts's other aliases.
  {
    key: "manualCount",
    label: "Manual Count",
    editable: true,
    aliases: ["Manual Counting"],
  },
  // Also system-computed (calculateVariance, server-side) - a file's own
  // "VARIANCE" column is never imported, so it can't disagree with what the
  // server derives from System Remaining - Manual Count.
  { key: "variance", label: "Variance" },
];

function toNum(v: number | string | null | undefined): number {
  if (v === null || v === undefined || v === "") return 0;
  return Number(v);
}

/// Same sessionStorage pattern as usePendingEntryChanges (Online/Offline
/// Entry) - see that file for the fuller rationale. Kept as a plain inline
/// helper rather than reusing that hook, since its `PendingByProduct` shape
/// (per-column edits) doesn't fit this page's flatter "one draft string per
/// product" shape.
function loadDrafts(storageKey: string): Record<number, string> {
  try {
    const raw = sessionStorage.getItem(storageKey);
    return raw ? (JSON.parse(raw) as Record<number, string>) : {};
  } catch {
    return {};
  }
}

/// Section 4.4 - the supervisor (or encoder on duty) enters the physical
/// count; Variance = System Remaining Stock - Manual Count is always
/// system-calculated, never typed directly.
export function ManualCountPage() {
  // Date and shift default together (see getCurrentShiftAndDate) - Night
  // crosses midnight, so they can't be defaulted independently without
  // risking a wrong-day shift right after 12am.
  const [{ date, shift }, setDateShift] = useState(getCurrentShiftAndDate);
  const setDate = (d: string) => setDateShift((prev) => ({ ...prev, date: d }));
  const setShift = (s: Shift) =>
    setDateShift((prev) => ({ ...prev, shift: s }));
  const [location, setLocation] = useState<StockLocation>("ONLINE");
  const [rows, setRows] = useState<ManualCountGridRow[] | null>(null);
  // Which categories are expanded - absent means collapsed (the default), a
  // category with a pending draft force-expands regardless of this map. See
  // StockGrid's identical `expandedOverride`/`pending` pair (Online/Offline
  // Entry) for the fuller rationale - same behavior here.
  const [expandedOverride, setExpandedOverride] = useState<
    Record<string, boolean>
  >({});
  // Staged-but-unsaved counts, persisted to sessionStorage under this
  // date+shift+location's own key - same reasoning as usePendingEntryChanges
  // (Online/Offline Entry): survives navigating to a different page and back,
  // or switching date/shift/location and back, instead of always starting
  // empty.
  const draftsStorageKey = `ala-eh-manual-count-pending:${date}:${shift}:${location}`;
  const [drafts, setDrafts] = useState<Record<number, string>>(() =>
    loadDrafts(draftsStorageKey),
  );
  const [error, setError] = useState<string | null>(null);
  const [zoom, setZoom] = useZoom("manual-count");
  const [query, setQuery] = useState("");
  const [categoryFilter, setCategoryFilter] = useState("");
  const [saving, setSaving] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);

  function load() {
    setRows(null);
    getManualCountGrid(date, shift, location)
      .then(setRows)
      .catch((e) => setError(e.message));
  }

  useEffect(load, [date, shift, location]);

  // Re-derives drafts from storage whenever the key itself changes (a
  // different date/shift/location) - not cleared here the way `setRows(null)`
  // above is, so whichever combination is being left keeps what it had
  // staged (still there if switched back to) and the one being loaded picks
  // up whatever it already had staged.
  useEffect(() => {
    setDrafts(loadDrafts(draftsStorageKey));
  }, [draftsStorageKey]);

  useEffect(() => {
    try {
      if (Object.keys(drafts).length === 0)
        sessionStorage.removeItem(draftsStorageKey);
      else sessionStorage.setItem(draftsStorageKey, JSON.stringify(drafts));
    } catch {
      // Best effort - editing still works either way.
    }
  }, [drafts, draftsStorageKey]);

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
        const saved = await saveManualCount(
          productId,
          date,
          shift,
          location,
          Number(draft),
        );
        // Merge the recalculated row (system remaining stock + variance) in
        // directly instead of re-fetching the whole grid for one edit.
        setRows(
          (prev) =>
            prev?.map((r) =>
              r.product.id === productId
                ? {
                    ...r,
                    entry: saved,
                    isSaved: true,
                    isFlagged: Number(saved.variance) !== 0,
                  }
                : r,
            ) ?? prev,
        );
        succeeded.push(productId);
      } catch (e) {
        const name =
          rows?.find((r) => r.product.id === productId)?.product.name ??
          `#${productId}`;
        // The server's own message is the actual reason - without it, every
        // failure looks identical no matter what actually went wrong.
        const reason = e instanceof Error ? e.message : "unknown error";
        failed.push(`${name} (${reason})`);
      }
    }
    setDrafts((d) => {
      const next = { ...d };
      for (const id of succeeded) delete next[id];
      return next;
    });
    setSaving(false);
    setShowConfirm(false);
    if (failed.length) setError(`Failed to save: ${failed.join("; ")}`);
  }

  const pendingCount = Object.keys(drafts).length;
  // What the confirm modal lists - one row per staged (non-blank) draft,
  // resolved against the last-loaded rows for the product name/old count.
  const pendingChanges = Object.entries(drafts)
    .filter(([, draft]) => draft !== "")
    .map(([productIdStr, draft]) => {
      const productId = Number(productIdStr);
      const row = rows?.find((r) => r.product.id === productId);
      return {
        productId,
        name: row?.product.name ?? `#${productId}`,
        oldValue: row?.entry.manualCount ?? "—",
        newValue: draft,
      };
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

  const categories = Array.from(
    new Set((rows ?? []).map((r) => r.product.category)),
  ).sort();
  const visibleRows = rows?.filter(
    (r) =>
      matchesSearch(
        [r.product.sku, r.product.name, r.product.category],
        query,
      ) &&
      (categoryFilter === "" || r.product.category === categoryFilter),
  );
  // Grouped the same way as StockGrid/TotalStocksTable, for the same
  // collapsible-category treatment.
  const groupedRows = new Map<string, ManualCountGridRow[]>();
  for (const r of visibleRows ?? []) {
    const list = groupedRows.get(r.product.category) ?? [];
    list.push(r);
    groupedRows.set(r.product.category, list);
  }

  return (
    <div>
      <PageHeader
        title={
          <>
            Manual Counting &amp; Variance - {formatDateDisplay(date)} -{" "}
            {SHIFT_SHORT_LABELS[shift]} Shift
          </>
        }
        subtitle="Review and correct manual counts for the selected date."
      >
      <Toolbar className="no-print">
        <div
          style={{
            display: "flex",
            gap: 10,
            alignItems: "center",
            flexWrap: "nowrap",
            minWidth: 0,
          }}
        >
          <DatePicker
            aria-label="Date"
            value={date}
            onChange={setDate}
            todayValue={getCurrentShiftAndDate().date}
          />
          <ShiftFilter value={shift} onChange={(s) => s && setShift(s)} />
          <Dropdown
            aria-label="Location"
            value={location}
            onChange={(v) => setLocation(v as StockLocation)}
            options={LOCATIONS.map((l) => ({ value: l, label: l }))}
          />
          <SearchInput
            value={query}
            onChange={setQuery}
            placeholder="Search SKU or category…"
          />
          <CategoryFilter
            categories={categories}
            value={categoryFilter}
            onChange={setCategoryFilter}
          />
          {flaggedCount > 0 && (
            <span
              style={{
                color: colors.warningText,
                fontSize: 13,
                fontWeight: 600,
                whiteSpace: "nowrap",
                flexShrink: 0,
              }}
              title={`${flaggedCount} product(s) with a non-zero variance`}
            >
              ⚠ {flaggedCount}
              <span className="ae-toolbar-btn-label"> flagged</span>
            </span>
          )}
        </div>
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
            <span className="ae-toolbar-btn-label">
              {saving
                ? "Saving…"
                : `Save${pendingCount > 0 ? ` (${pendingCount})` : ""}`}
            </span>
          </Button>
          {csvRows && (
            <>
              <CsvTools
                filenamePrefix={`manual-count-${location.toLowerCase()}-${shift.toLowerCase()}`}
                date={date}
                rows={csvRows}
                columns={csvColumns}
                // Import lives on the Online/Offline Entry pages only - this
                // page just exports (Excel/PDF), same as Total Stocks.
                onImportRow={async () => {}}
                getPendingValue={() => undefined}
                canImport={false}
                pdfDisabled={pendingCount > 0}
                exportFormat="excel"
                pdf={{
                  title: "Manual Counting & Variance",
                  subtitle: `${formatDateDisplay(date)} - ${SHIFT_SHORT_LABELS[shift]} Shift - ${location}`,
                  flagKey: "variance",
                }}
              />
              <ToolbarDivider />
            </>
          )}
          <ZoomControl zoom={zoom} onChange={setZoom} />
        </ToolbarControls>
      </Toolbar>
      </PageHeader>
      {error && <p style={{ color: colors.danger }}>{error}</p>}
      {!rows ? (
        <TableSkeleton
          headers={[
            "SKU",
            "Product",
            "System Remaining",
            "Manual Count",
            "Variance",
          ]}
          minWidth={640}
          label="Loading manual counts…"
        />
      ) : (
        <div className="ae-grid-fill" style={zoomStyle(zoom)}>
          {/* Same containment as StockGrid: the scrollbar belongs to this
              inner wrapper, not the page - at high zoom the table scrolls
              sideways in place instead of pushing the whole page (heading,
              date/location fields) off to the right. */}
          <RowGlowScroll
            focusStorageKey={`ala-eh-focus:manual-count:${date}:${shift}:${location}`}
          >
            <table
              className="ae-table ae-table--center-head"
              style={{ minWidth: 640 }}
            >
              <thead>
                <tr>
                  {[
                    "SKU",
                    "Product",
                    "System Remaining",
                    "Manual Count",
                    "Variance",
                  ].map((h) => (
                    <th key={h}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {[...groupedRows.entries()].map(([category, groupRows]) => {
                  const hasPending = groupRows.some(
                    (r) => drafts[r.product.id] !== undefined,
                  );
                  const isExpanded = hasPending || !!expandedOverride[category];
                  const isCollapsed = !isExpanded;
                  return (
                    <Fragment key={category}>
                      <tr>
                        <td colSpan={5} style={{ padding: 0 }}>
                          <button
                            type="button"
                            onClick={() =>
                              setExpandedOverride((e) => ({
                                ...e,
                                [category]: !isExpanded,
                              }))
                            }
                            aria-expanded={!isCollapsed}
                            title={
                              hasPending
                                ? `${category} has unsaved counts, so it stays expanded`
                                : isCollapsed
                                  ? `Expand ${category}`
                                  : `Collapse ${category}`
                            }
                            style={categoryToggleStyle}
                          >
                            <span
                              style={{
                                display: "inline-flex",
                                transform: isCollapsed
                                  ? "rotate(-90deg)"
                                  : "none",
                                transition:
                                  "transform 260ms cubic-bezier(0.22, 1, 0.36, 1)",
                              }}
                            >
                              <ChevronIcon />
                            </span>
                            {category}
                          </button>
                        </td>
                      </tr>
                      {groupRows.map((r) => (
                        <tr
                          key={r.product.id}
                          data-row-id={r.product.id}
                          className={
                            isCollapsed
                              ? "ae-cat-row ae-row-collapsed"
                              : "ae-cat-row"
                          }
                          style={
                            r.isFlagged
                              ? { background: colors.warningBg }
                              : undefined
                          }
                        >
                          <td style={skuCellStyle}>{r.product.sku ?? "—"}</td>
                          <td style={nameCellStyle}>{r.product.name}</td>
                          <td>
                            {Number(
                              r.entry.systemRemainingStock,
                            ).toLocaleString()}
                          </td>
                          <td>
                            <NumberCellInput
                              value={String(
                                drafts[r.product.id] ??
                                  r.entry.manualCount ??
                                  "",
                              )}
                              onChange={(v) =>
                                setDrafts((d) => ({ ...d, [r.product.id]: v }))
                              }
                              onKeyDown={(e) =>
                                e.key === "Enter" &&
                                (e.currentTarget as HTMLInputElement).blur()
                              }
                              style={{ width: 64, textAlign: "center" }}
                            />
                          </td>
                          <td style={{ fontWeight: r.isFlagged ? 700 : 400 }}>
                            {r.entry.variance ?? "—"}
                          </td>
                        </tr>
                      ))}
                      <tr style={subtotalRowStyle}>
                        <td colSpan={2}>Subtotal - {category}</td>
                        <td>
                          {groupRows
                            .reduce(
                              (sum, r) =>
                                sum + toNum(r.entry.systemRemainingStock),
                              0,
                            )
                            .toLocaleString()}
                        </td>
                        <td>
                          {groupRows
                            .reduce(
                              (sum, r) => sum + toNum(r.entry.manualCount),
                              0,
                            )
                            .toLocaleString()}
                        </td>
                        <td>
                          {groupRows
                            .reduce(
                              (sum, r) => sum + toNum(r.entry.variance),
                              0,
                            )
                            .toLocaleString()}
                        </td>
                      </tr>
                    </Fragment>
                  );
                })}
                <tr style={grandTotalRowStyle}>
                  <td colSpan={2}>GRAND TOTAL</td>
                  <td>
                    {(visibleRows ?? [])
                      .reduce(
                        (sum, r) => sum + toNum(r.entry.systemRemainingStock),
                        0,
                      )
                      .toLocaleString()}
                  </td>
                  <td>
                    {(visibleRows ?? [])
                      .reduce((sum, r) => sum + toNum(r.entry.manualCount), 0)
                      .toLocaleString()}
                  </td>
                  <td>
                    {(visibleRows ?? [])
                      .reduce((sum, r) => sum + toNum(r.entry.variance), 0)
                      .toLocaleString()}
                  </td>
                </tr>
              </tbody>
            </table>
          </RowGlowScroll>
        </div>
      )}
      {showConfirm && (
        <Modal
          title="Confirm manual counts"
          onClose={() => setShowConfirm(false)}
        >
          {pendingChanges.length === 0 ? (
            <p style={{ margin: 0, color: colors.subtleInk, fontSize: 13 }}>
              No unsaved changes.
            </p>
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
                    <td style={{ textAlign: "left", color: colors.ink }}>
                      {c.name}
                    </td>
                    <td>{c.oldValue}</td>
                    <td style={{ fontWeight: 700, color: colors.yellow }}>
                      {c.newValue}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
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
              onClick={() => setShowConfirm(false)}
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
    </div>
  );
}

const nameCellStyle: CSSProperties = {
  textAlign: "left",
  whiteSpace: "nowrap",
  color: colors.ink,
};
const skuCellStyle: CSSProperties = {
  textAlign: "left",
  whiteSpace: "nowrap",
  color: colors.yellow,
  fontVariantNumeric: "tabular-nums",
};
// Same three styles as StockGrid/TotalStocksTable - see StockGrid's
// categoryToggleStyle doc comment for why this is a real <button>.
const categoryToggleStyle: CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 6,
  width: "100%",
  textAlign: "left",
  font: "inherit",
  fontWeight: 700,
  padding: "6px 8px",
  border: "none",
  borderLeft: `4px solid ${colors.red}`,
  background: "var(--ae-category-bg)",
  color: colors.yellow,
  cursor: "pointer",
};
const subtotalRowStyle: CSSProperties = {
  fontWeight: 600,
  background: colors.paperAlt,
};
const grandTotalRowStyle: CSSProperties = {
  fontWeight: 700,
  background: colors.warningBg,
  borderTop: `2px solid ${colors.black}`,
};
