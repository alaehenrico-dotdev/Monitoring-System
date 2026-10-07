import {
  Fragment,
  useEffect,
  useState,
  type CSSProperties,
  type KeyboardEvent,
} from "react";
import { getManualCountGrid, saveManualCount } from "../api/manualCounts";
import type {
  ManualCountEntry,
  ManualCountGridRow,
  StockLocation,
} from "../types";
import { Button, NumberCellInput } from "../components/ui";
import { DatePicker } from "../components/DatePicker";
import { useZoom, zoomStyle, ZoomControl } from "../components/ZoomControl";
import { CsvTools } from "../components/CsvTools";
import {
  Toolbar,
  ToolbarControls,
  ToolbarDivider,
} from "../components/Toolbar";
import { PageHeader } from "../components/PageHeader";
import { Toast } from "../components/Toast";
import { SearchInput } from "../components/SearchInput";
import { CategoryFilter } from "../components/CategoryFilter";
import { ShiftFilter } from "../components/ShiftFilter";
import { StockSourceFilter } from "../components/StockSourceFilter";
import { ChevronIcon, PrinterIcon, SaveIcon } from "../components/icons";
import { Modal } from "../components/Modal";
import { matchesSearch } from "../utils/search";
import { formatDateDisplay } from "../utils/dateFormat";
import { downloadTablePdf } from "../utils/tablePdf";
import { pdfFileName, stockGridSection } from "../utils/pdfTables";
import { getCurrentShiftAndDate, SHIFT_SHORT_LABELS } from "../utils/shift";
import { colors } from "../theme";
import { RowGlowScroll } from "../components/RowGlowScroll";
import { TableSkeleton } from "../components/Skeleton";
import type { Shift } from "../types";
import { useResetOnKeyChange } from "../hooks/useResetOnKeyChange";
import { useRealtimeVersion } from "../context/RealtimeContext";
import { useTopProgress } from "../hooks/useTopProgress";

/// The two places stock is physically counted. Both are entered on this one
/// page; each is still stored (and its variance computed) per location.
type CountLocation = "ONLINE" | "OFFLINE";
const COUNT_LOCATIONS: CountLocation[] = ["ONLINE", "OFFLINE"];
const LOCATION_LABEL: Record<CountLocation, string> = {
  ONLINE: "Online",
  OFFLINE: "Offline",
};

/// The filter reuses StockLocation ("TOTAL" standing in for "Both", same as
/// Total Stocks' StockSourceFilter).
const FILTER_LABEL: Record<StockLocation, string> = {
  TOTAL: "Online + Offline",
  ONLINE: "Online",
  OFFLINE: "Offline",
};

/// Import is per location (a monthly file is either the Online or the
/// Offline count sheet) - unchanged from the single-count version of this
/// page, so the file's own "Manual Count" column feeds the chosen location.
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

type Drafts = Record<CountLocation, Record<number, string>>;

/// Same sessionStorage pattern as usePendingEntryChanges (Online/Offline
/// Entry) - see that file for the fuller rationale. One key per location
/// (same key shape as before, so utils/unsavedWork.ts still finds them).
/// Kept as plain inline helpers rather than reusing that hook, since its
/// `PendingByProduct` shape (per-column edits) doesn't fit this page's
/// flatter "one draft string per product" shape.
const draftsKey = (date: string, shift: Shift, loc: CountLocation) =>
  `ala-eh-manual-count-pending:${date}:${shift}:${loc}`;

function loadDrafts(date: string, shift: Shift): Drafts {
  const load = (loc: CountLocation): Record<number, string> => {
    try {
      const raw = sessionStorage.getItem(draftsKey(date, shift, loc));
      return raw ? (JSON.parse(raw) as Record<number, string>) : {};
    } catch {
      return {};
    }
  };
  return { ONLINE: load("ONLINE"), OFFLINE: load("OFFLINE") };
}

interface AuditRow {
  product: ManualCountGridRow["product"];
  entries: Record<CountLocation, ManualCountEntry>;
  saved: Record<CountLocation, boolean>;
}

interface Figures {
  system: number;
  /// null = nothing counted (or staged) for that location.
  online: number | null;
  offline: number | null;
  total: number;
  /// null = nothing counted in the visible location(s), so no variance yet.
  variance: number | null;
}

/// Section 4.4 - the supervisor (or encoder on duty) enters the physical
/// count at each location; Variance = System Remaining Stock - Count is
/// always system-calculated, never typed directly. The Total column is just
/// the Offline + Online counts added together.
export function ManualCountPage() {
  // Date and shift default together (see getCurrentShiftAndDate) - Night
  // crosses midnight, so they can't be defaulted independently without
  // risking a wrong-day shift right after 12am.
  const [{ date, shift }, setDateShift] = useState(getCurrentShiftAndDate);
  const setDate = (d: string) => setDateShift((prev) => ({ ...prev, date: d }));
  const setShift = (s: Shift) =>
    setDateShift((prev) => ({ ...prev, shift: s }));
  // Which location(s) the table shows/edits: "TOTAL" = both.
  const [sourceFilter, setSourceFilter] = useState<StockLocation>("TOTAL");
  // Which location a CSV import goes into when the filter shows both.
  const [importLocation, setImportLocation] = useState<CountLocation>("ONLINE");
  const csvLocation: CountLocation =
    sourceFilter === "TOTAL" ? importLocation : sourceFilter;
  const showOffline = sourceFilter !== "ONLINE";
  const showOnline = sourceFilter !== "OFFLINE";

  const [gridRows, setGridRows] = useState<Record<
    CountLocation,
    ManualCountGridRow[]
  > | null>(null);
  // Which categories are expanded - absent means collapsed (the default), a
  // category with a pending draft force-expands regardless of this map. See
  // StockGrid's identical `expandedOverride`/`pending` pair (Online/Offline
  // Entry) for the fuller rationale - same behavior here.
  const [expandedOverride, setExpandedOverride] = useState<
    Record<string, boolean>
  >({});
  // Staged-but-unsaved counts, persisted to sessionStorage under this
  // date+shift's own keys - same reasoning as usePendingEntryChanges
  // (Online/Offline Entry): survives navigating to a different page and back,
  // or switching date/shift and back, instead of always starting empty.
  const [drafts, setDrafts] = useState<Drafts>(() => loadDrafts(date, shift));
  // location -> productId -> the Import History batch its still-staged draft
  // came from - threaded into saveManualCount at Save time so that write can
  // later be found and reverted. Not persisted (unlike drafts) - losing this
  // on reload just means a revived draft after a refresh saves as a plain
  // edit instead of staying attributed to the import, same trade-off
  // CsvTools' own in-memory "Undo Import" already makes. Cleared for a
  // product/location the moment its draft is set WITHOUT a batch id (see
  // setDraft) - a hand-edit after import must never let a later "delete this
  // import" clobber it.
  const [importedBatchByProduct, setImportedBatchByProduct] = useState<
    Record<CountLocation, Record<number, number>>
  >({ ONLINE: {}, OFFLINE: {} });
  const [error, setError] = useState<string | null>(null);
  const [zoom, setZoom] = useZoom("manual-count");
  const [query, setQuery] = useState("");
  const [categoryFilter, setCategoryFilter] = useState("");
  const [saving, setSaving] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const realtimeVersion = useRealtimeVersion();
  const progress = useTopProgress();

  useResetOnKeyChange(`${date}:${shift}`, () => {
    setGridRows(null);
    // Not cleared: whichever date/shift is being left keeps what it had
    // staged (still there if switched back to) and the one being loaded
    // picks up whatever it already had staged.
    setDrafts(loadDrafts(date, shift));
  });
  useEffect(() => {
    Promise.all([
      getManualCountGrid(date, shift, "ONLINE"),
      getManualCountGrid(date, shift, "OFFLINE"),
    ])
      .then(([ONLINE, OFFLINE]) => setGridRows({ ONLINE, OFFLINE }))
      .catch((e) => setError(e.message));
  }, [date, shift, realtimeVersion]);

  useEffect(() => {
    for (const loc of COUNT_LOCATIONS) {
      try {
        const key = draftsKey(date, shift, loc);
        if (Object.keys(drafts[loc]).length === 0)
          sessionStorage.removeItem(key);
        else sessionStorage.setItem(key, JSON.stringify(drafts[loc]));
      } catch {
        // Best effort - editing still works either way.
      }
    }
  }, [drafts, date, shift]);

  const pendingCount =
    Object.keys(drafts.ONLINE).length + Object.keys(drafts.OFFLINE).length;

  // Warn before navigating/closing the tab with staged-but-unsaved counts -
  // same guard as Online/Offline Entry, now that a typed count no longer
  // saves on blur.
  useEffect(() => {
    if (pendingCount === 0) return;
    function onBeforeUnload(e: BeforeUnloadEvent) {
      e.preventDefault();
    }
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, [pendingCount]);

  function setDraft(
    loc: CountLocation,
    productId: number,
    value: string,
    batchId?: number,
  ) {
    setDrafts((d) => ({ ...d, [loc]: { ...d[loc], [productId]: value } }));
    setImportedBatchByProduct((prev) => {
      const locMap = { ...prev[loc] };
      if (batchId !== undefined) locMap[productId] = batchId;
      else delete locMap[productId];
      return { ...prev, [loc]: locMap };
    });
  }

  // Typing a count only stages a local draft (see the input's onChange
  // below) - it no longer saves on blur. Save opens a quick confirm step
  // (below) listing exactly what's about to be written, then this flushes
  // every staged count in one pass, same "per-product save endpoint"
  // pattern as Online/Offline Entry. PDF stays disabled the whole time a
  // draft is unsaved, so a printed sheet can never show a count that was
  // typed but never actually persisted.
  async function handleSaveAll() {
    setError(null);
    setSaving(true);
    const failed: string[] = [];
    const succeeded: { loc: CountLocation; productId: number }[] = [];
    for (const loc of COUNT_LOCATIONS) {
      for (const [productIdStr, draft] of Object.entries(drafts[loc])) {
        const productId = Number(productIdStr);
        if (draft === "") {
          succeeded.push({ loc, productId });
          continue;
        }
        try {
          const saved = await saveManualCount(
            productId,
            date,
            shift,
            loc,
            Number(draft),
            importedBatchByProduct[loc][productId],
          );
          // Merge the recalculated row (system remaining stock + variance) in
          // directly instead of re-fetching the whole grid for one edit.
          setGridRows((prev) =>
            prev
              ? {
                  ...prev,
                  [loc]: prev[loc].map((r) =>
                    r.product.id === productId
                      ? {
                          ...r,
                          entry: saved,
                          isSaved: true,
                          isFlagged: Number(saved.variance) !== 0,
                        }
                      : r,
                  ),
                }
              : prev,
          );
          succeeded.push({ loc, productId });
        } catch (e) {
          const name =
            gridRows?.[loc].find((r) => r.product.id === productId)?.product
              .name ?? `#${productId}`;
          // The server's own message is the actual reason - without it, every
          // failure looks identical no matter what actually went wrong.
          const reason = e instanceof Error ? e.message : "unknown error";
          failed.push(`${name} - ${LOCATION_LABEL[loc]} (${reason})`);
        }
      }
    }
    setDrafts((d) => {
      const next: Drafts = {
        ONLINE: { ...d.ONLINE },
        OFFLINE: { ...d.OFFLINE },
      };
      for (const s of succeeded) delete next[s.loc][s.productId];
      return next;
    });
    setImportedBatchByProduct((prev) => {
      const next = { ONLINE: { ...prev.ONLINE }, OFFLINE: { ...prev.OFFLINE } };
      for (const s of succeeded) delete next[s.loc][s.productId];
      return next;
    });
    setSaving(false);
    setShowConfirm(false);
    if (failed.length) setError(`Failed to save: ${failed.join("; ")}`);
  }

  // CSV import stages each row's Manual Count as a draft for the chosen
  // location - identical to typing it - so the usual Save/confirm step still
  // applies.
  async function handleImportRow(
    productId: number,
    values: Record<string, number>,
    batchId?: number,
  ) {
    if (values.manualCount === undefined) return;
    setDraft(csvLocation, productId, String(values.manualCount), batchId);
  }

  // One merged row per product, holding both locations' entries.
  const auditRows: AuditRow[] | null = gridRows
    ? gridRows.ONLINE.map((on) => {
        const off = gridRows.OFFLINE.find(
          (r) => r.product.id === on.product.id,
        );
        return {
          product: on.product,
          entries: {
            ONLINE: on.entry,
            OFFLINE: off?.entry ?? {
              ...on.entry,
              location: "OFFLINE" as const,
              systemRemainingStock: 0,
              manualCount: null,
              variance: null,
            },
          },
          saved: { ONLINE: on.isSaved, OFFLINE: off?.isSaved ?? false },
        };
      })
    : null;

  // Live figures per row for the current filter: a staged draft overrides the
  // saved count, and its variance is recomputed (System Remaining - Count,
  // same formula as the server) so subtotals/grand total update before
  // anything is saved. With both locations shown, variance adds up each
  // location that HAS a count (an uncounted location contributes nothing
  // rather than showing its whole stock as missing). Blank drafts count as 0.
  function liveFigures(r: AuditRow): Figures {
    const count = (loc: CountLocation): number | null => {
      const draft = drafts[loc][r.product.id];
      if (draft !== undefined && draft !== "") return Number(draft) || 0;
      const saved = r.entries[loc].manualCount;
      return saved === null || saved === undefined ? null : toNum(saved);
    };
    const online = showOnline ? count("ONLINE") : null;
    const offline = showOffline ? count("OFFLINE") : null;
    const system =
      (showOnline ? toNum(r.entries.ONLINE.systemRemainingStock) : 0) +
      (showOffline ? toNum(r.entries.OFFLINE.systemRemainingStock) : 0);
    let variance: number | null = null;
    if (online !== null)
      variance =
        (variance ?? 0) + toNum(r.entries.ONLINE.systemRemainingStock) - online;
    if (offline !== null)
      variance =
        (variance ?? 0) +
        toNum(r.entries.OFFLINE.systemRemainingStock) -
        offline;
    return {
      system,
      online,
      offline,
      total: (online ?? 0) + (offline ?? 0),
      variance,
    };
  }
  const isFlagged = (r: AuditRow) => {
    const v = liveFigures(r).variance;
    return v !== null && v !== 0;
  };
  const sumLive = (
    list: AuditRow[],
    field: "system" | "online" | "offline" | "total" | "variance",
  ) => list.reduce((sum, r) => sum + (liveFigures(r)[field] ?? 0), 0);

  // What the confirm modal lists - one row per staged (non-blank) draft,
  // resolved against the last-loaded rows for the product name/old count.
  const pendingChanges = COUNT_LOCATIONS.flatMap((loc) =>
    Object.entries(drafts[loc])
      .filter(([, draft]) => draft !== "")
      .map(([productIdStr, draft]) => {
        const productId = Number(productIdStr);
        const row = auditRows?.find((r) => r.product.id === productId);
        return {
          key: `${loc}-${productId}`,
          name: row?.product.name ?? `#${productId}`,
          location: LOCATION_LABEL[loc],
          oldValue: row?.entries[loc].manualCount ?? "—",
          newValue: draft,
        };
      }),
  );
  const flaggedCount = auditRows?.filter(isFlagged).length ?? 0;

  // Nulls (not yet counted) export as blank cells rather than "0", which
  // would misleadingly read as a confirmed zero count.
  const csvRows = gridRows?.[csvLocation].map((r) => ({
    product: r.product,
    entry: {
      systemRemainingStock: r.entry.systemRemainingStock,
      manualCount: r.entry.manualCount ?? "",
      variance: r.entry.variance ?? "",
    },
  }));

  const categories = Array.from(
    new Set((auditRows ?? []).map((r) => r.product.category)),
  ).sort();
  const visibleRows = auditRows?.filter(
    (r) =>
      matchesSearch(
        [r.product.sku, r.product.name, r.product.category],
        query,
      ) &&
      (categoryFilter === "" || r.product.category === categoryFilter),
  );
  // Grouped the same way as StockGrid/TotalStocksTable, for the same
  // collapsible-category treatment.
  const groupedRows = new Map<string, AuditRow[]>();
  for (const r of visibleRows ?? []) {
    const list = groupedRows.get(r.product.category) ?? [];
    list.push(r);
    groupedRows.set(r.product.category, list);
  }
  const visibleProductIds = (visibleRows ?? []).map((r) => r.product.id);

  // Column order: the count inputs, then their Total, then Variance last.
  const headers = [
    "SKU",
    "Product",
    "System Remaining",
    ...(showOffline ? ["Offline Count"] : []),
    ...(showOnline ? ["Online Count"] : []),
    "Total Count",
    "Variance",
  ];
  const columnCount = headers.length;

  // Same Up/Down row-jump as StockGrid's handleKeyDown, within one count
  // column (Online and Offline are separate columns).
  function focusCount(loc: CountLocation, productId: number) {
    document
      .querySelector<HTMLInputElement>(
        `[data-cell="manual-count-${loc}-${productId}"]`,
      )
      ?.focus();
  }
  function handleCountKeyDown(
    e: KeyboardEvent<HTMLInputElement>,
    loc: CountLocation,
    productId: number,
  ) {
    const rowIndex = visibleProductIds.indexOf(productId);
    if (e.key === "Enter" || e.key === "ArrowDown") {
      e.preventDefault();
      const nextId = visibleProductIds[rowIndex + 1];
      if (nextId !== undefined) focusCount(loc, nextId);
      e.currentTarget.blur();
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      const prevId = visibleProductIds[rowIndex - 1];
      if (prevId !== undefined) focusCount(loc, prevId);
    }
  }

  // PDF of the table exactly as filtered on screen (same columns), built from
  // the row data like every other PDF in the app.
  async function handlePdf() {
    if (!visibleRows || pendingCount > 0) return;
    const pdfColumns = [
      { key: "system", label: "System Remaining" },
      ...(showOffline ? [{ key: "offline", label: "Offline Count" }] : []),
      ...(showOnline ? [{ key: "online", label: "Online Count" }] : []),
      { key: "total", label: "Total Count" },
      { key: "variance", label: "Variance" },
    ];
    const pdfName = pdfFileName(
      `audit-${FILTER_LABEL[sourceFilter].toLowerCase().replace(/\W+/g, "-")}`,
      date,
      shift,
    );
    try {
      await progress.track(() =>
        downloadTablePdf({
          filename: pdfName,
          title: "Manual Counting & Variance",
          subtitle: `${formatDateDisplay(date)} - ${SHIFT_SHORT_LABELS[shift]} Shift - ${FILTER_LABEL[sourceFilter]}`,
          sections: [
            stockGridSection(
              visibleRows.map((r) => {
                const f = liveFigures(r);
                return {
                  product: r.product,
                  isFlagged: isFlagged(r),
                  entry: {
                    system: f.system,
                    variance: f.variance ?? "",
                    offline: f.offline ?? "",
                    online: f.online ?? "",
                    total:
                      f.online === null && f.offline === null ? "" : f.total,
                  },
                };
              }),
              pdfColumns,
              { flagKey: "variance" },
            ),
          ],
        }),
      );
    } catch (e) {
      setError(e instanceof Error ? `PDF failed: ${e.message}` : "PDF failed");
    }
  }

  const varianceCell = (value: number | null): CSSProperties => ({
    ...manualCountTint.Variance,
    fontWeight: value !== null && value !== 0 ? 700 : 400,
    color: value !== null && value < 0 ? colors.danger : undefined,
  });

  return (
    <div>
      <PageHeader
        title={
          <>
            Manual Counting &amp; Variance - {formatDateDisplay(date)} -{" "}
            {SHIFT_SHORT_LABELS[shift]} Shift - {FILTER_LABEL[sourceFilter]}
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
            <StockSourceFilter
              value={sourceFilter}
              onChange={setSourceFilter}
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
              className="ae-toolbar-save ae-toolbar-primary"
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
            <Button
              className="ae-toolbar-save"
              type="button"
              variant="secondary"
              size="sm"
              onClick={handlePdf}
              disabled={pendingCount > 0 || !visibleRows}
              title={
                pendingCount > 0
                  ? "Save your changes first - PDF reflects only saved data"
                  : "Download as PDF"
              }
            >
              <PrinterIcon />
              <span className="ae-toolbar-btn-label">PDF</span>
            </Button>
            <CsvTools
              filenamePrefix={`manual-count-${csvLocation.toLowerCase()}-${shift.toLowerCase()}`}
              date={date}
              rows={csvRows ?? []}
              disabled={!csvRows}
              importTarget={{ date, shift, location: csvLocation }}
              onImportTargetChange={(t) => {
                setDateShift({ date: t.date, shift: t.shift });
                if (t.location === "ONLINE" || t.location === "OFFLINE") {
                  setImportLocation(t.location);
                  // A location-specific view follows the import target so the
                  // staged counts land in the column being looked at.
                  if (sourceFilter !== "TOTAL") setSourceFilter(t.location);
                }
              }}
              importLocations={COUNT_LOCATIONS}
              importTodayValue={getCurrentShiftAndDate().date}
              columns={csvColumns}
              // Import reads ONLY the file's Manual Count column (never
              // Remaining Stocks); blank cells count as 0. Imported values
              // are staged as drafts for the chosen location, same as typing -
              // Save commits them.
              onImportRow={handleImportRow}
              getPendingValue={(productId) => {
                const d = drafts[csvLocation][productId];
                return d === undefined || d === "" ? undefined : Number(d);
              }}
              canImport
              importKeys={["manualCount"]}
              blankAsZero
              showExport={false}
              showPdf={false}
            />
            <ToolbarDivider />
            <ZoomControl zoom={zoom} onChange={setZoom} />
          </ToolbarControls>
        </Toolbar>
      </PageHeader>
      <Toast
        message={error}
        onDismiss={() => setError(null)}
        variant="error"
        duration={null}
      />
      {!auditRows ? (
        <TableSkeleton
          headers={headers}
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
            focusStorageKey={`ala-eh-focus:manual-count:${date}:${shift}`}
          >
            <table className="ae-table ae-table--center-head ae-table--compact">
              <thead>
                <tr>
                  {headers.map((h) => (
                    <th key={h} style={manualCountHeadStyle[h]}>
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {[...groupedRows.entries()].map(([category, groupRows]) => {
                  const hasPending = groupRows.some(
                    (r) =>
                      drafts.ONLINE[r.product.id] !== undefined ||
                      drafts.OFFLINE[r.product.id] !== undefined,
                  );
                  const isExpanded = hasPending || !!expandedOverride[category];
                  const isCollapsed = !isExpanded;
                  return (
                    <Fragment key={category}>
                      <tr>
                        <td colSpan={columnCount} style={{ padding: 0 }}>
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
                            className="ae-cat-toggle"
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
                      {groupRows.map((r) => {
                        const f = liveFigures(r);
                        const countCell = (loc: CountLocation) => (
                          <td key={loc} style={manualCountTint["Count"]}>
                            <NumberCellInput
                              data-cell={`manual-count-${loc}-${r.product.id}`}
                              value={String(
                                drafts[loc][r.product.id] ??
                                  r.entries[loc].manualCount ??
                                  "",
                              )}
                              onChange={(v) => setDraft(loc, r.product.id, v)}
                              onKeyDown={(e) =>
                                handleCountKeyDown(e, loc, r.product.id)
                              }
                              style={{ width: 64, textAlign: "center" }}
                            />
                          </td>
                        );
                        return (
                          <tr
                            key={r.product.id}
                            data-row-id={r.product.id}
                            className={
                              isCollapsed
                                ? "ae-cat-row ae-row-collapsed"
                                : "ae-cat-row"
                            }
                            style={
                              isFlagged(r)
                                ? { background: colors.warningBg }
                                : undefined
                            }
                          >
                            <td className="ae-cell-sku">
                              {r.product.sku ?? "—"}
                            </td>
                            <td className="ae-cell-name">{r.product.name}</td>
                            <td>{f.system.toLocaleString()}</td>
                            {showOffline && countCell("OFFLINE")}
                            {showOnline && countCell("ONLINE")}
                            <td
                              style={{
                                ...manualCountTint.Total,
                                fontWeight: 600,
                              }}
                            >
                              {f.online === null && f.offline === null
                                ? "—"
                                : f.total.toLocaleString()}
                            </td>
                            <td style={varianceCell(f.variance)}>
                              {f.variance === null
                                ? "—"
                                : f.variance.toLocaleString()}
                            </td>
                          </tr>
                        );
                      })}
                      <tr className="ae-row-subtotal">
                        <td colSpan={2}>Subtotal - {category}</td>
                        {renderTotals(groupRows)}
                      </tr>
                    </Fragment>
                  );
                })}
                <tr className="ae-row-grand">
                  <td colSpan={2}>GRAND TOTAL</td>
                  {renderTotals(visibleRows ?? [])}
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
                  <th>Location</th>
                  <th>Old count</th>
                  <th>New count</th>
                </tr>
              </thead>
              <tbody>
                {pendingChanges.map((c) => (
                  <tr key={c.key}>
                    <td style={{ textAlign: "left", color: colors.ink }}>
                      {c.name}
                    </td>
                    <td style={{ textAlign: "left", color: colors.ink }}>
                      {c.location}
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

  // Subtotal / grand-total cells for a set of rows, in column order.
  function renderTotals(list: AuditRow[]) {
    const variance = sumLive(list, "variance");
    return (
      <>
        <td>{sumLive(list, "system").toLocaleString()}</td>
        {showOffline && (
          <td style={manualCountTint["Count"]}>
            {sumLive(list, "offline").toLocaleString()}
          </td>
        )}
        {showOnline && (
          <td style={manualCountTint["Count"]}>
            {sumLive(list, "online").toLocaleString()}
          </td>
        )}
        <td style={manualCountTint.Total}>
          {sumLive(list, "total").toLocaleString()}
        </td>
        <td
          style={{
            ...manualCountTint.Variance,
            color: variance < 0 ? colors.danger : undefined,
          }}
        >
          {variance.toLocaleString()}
        </td>
      </>
    );
  }
}

// Column color coding for the count grid: the two count inputs in blue,
// Variance in teal (a cool color that sits next to the blue without being
// mistaken for it), the Total in the brand gold. Header-only, fixed fills
// with brand-ink / white labels so they read the same in light and dark mode.
const manualCountHeadStyle: Record<string, CSSProperties | undefined> = {
  "Offline Count": { background: "#3B82F6", color: "#FFFFFF" },
  "Online Count": { background: "#3B82F6", color: "#FFFFFF" },
  Variance: { background: "#2DB7A8", color: "#0C0C0C" },
  "Total Count": { background: "#F5C000", color: "#0C0C0C" },
};

// Body-cell tint for the same columns (whole column, not just the header).
// A translucent background-IMAGE layer, so the table's row-hover fill (a
// background-color) still shows through and the hover effect is unchanged.
function tintLayer(color: string): CSSProperties {
  const tint = `color-mix(in srgb, ${color} 22%, transparent)`;
  return { backgroundImage: `linear-gradient(${tint}, ${tint})` };
}
const manualCountTint: Record<"Count" | "Variance" | "Total", CSSProperties> = {
  Count: tintLayer("#3B82F6"),
  Variance: tintLayer("#2DB7A8"),
  Total: tintLayer("#F5C000"),
};
