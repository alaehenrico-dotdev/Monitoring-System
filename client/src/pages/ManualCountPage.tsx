import {
  Fragment,
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent,
} from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import {
  CategoryColorMenu,
  type CategoryMenuTarget,
} from "../components/CategoryColorMenu";
import { inkFor, useCategoryColors } from "../hooks/useColumnColors";
import { getManualCountGrid, publishManualCounts, saveManualCount } from "../api/manualCounts";
import { recordReportHistory } from "../api/reportHistory";
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
import {
  ChevronIcon,
  ClearIcon,
  CollapseAllIcon,
  ExpandAllIcon,
  HistoryIcon,
  PrinterIcon,
  ReportIcon,
  SaveIcon,
  UndoIcon,
  PublishIcon,
} from "../components/icons";
import { ConfirmDialog } from "../components/ConfirmDialog";
import { VarianceDetails } from "../components/VarianceDetails";
import { Dropdown } from "../components/Dropdown";
import { Modal } from "../components/Modal";
import { LoadingOverlay } from "../components/Spinner";
import { matchesSearch } from "../utils/search";
import { planCountPaste } from "../utils/manualCountPaste";
import {
  draftAction,
  isRealChange as isRealDraftChange,
} from "../utils/manualCountDrafts";
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
import { useUndoRedoKeys } from "../hooks/useGridView";
import { useAuth } from "../context/AuthContext";
import { useTopProgress } from "../hooks/useTopProgress";
import type { ToastVariant } from "../components/Toast";

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

/// What an undo step restores: the staged counts and which CSV import batch
/// each one came from.
interface DraftSnapshot {
  drafts: Drafts;
  batches: Record<CountLocation, Record<number, number>>;
}
const HISTORY_LIMIT = 100;
const sameSnapshot = (a: DraftSnapshot, b: DraftSnapshot) =>
  JSON.stringify(a) === JSON.stringify(b);

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
  /// Opening stock that does not match what the previous period carries
  /// forward (see ManualCountGridRow.openingBreak), per location.
  breaks: Record<CountLocation, { expected: number; actual: number } | null>;
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
  // Opened from Audit History (/audit-history): that link carries the date,
  // shift and source of the sheet to rebuild, which seed the state below and
  // trigger the PDF once the counts have loaded (same as the report pages).
  const [searchParams] = useSearchParams();
  const openedFromHistory = searchParams.get("history") === "1";
  const printAfterLoad = useRef(openedFromHistory);
  const [{ date, shift }, setDateShift] = useState<{
    date: string;
    shift: Shift;
  }>(() => {
    const now = getCurrentShiftAndDate();
    const d = searchParams.get("date") ?? "";
    const s = searchParams.get("shift");
    if (!openedFromHistory || !/^\d{4}-\d{2}-\d{2}$/.test(d)) return now;
    return { date: d, shift: s === "MORNING" || s === "NIGHT" ? s : now.shift };
  });
  const setDate = (d: string) => setDateShift((prev) => ({ ...prev, date: d }));
  const setShift = (s: Shift) =>
    setDateShift((prev) => ({ ...prev, shift: s }));
  // Which location(s) the table shows/edits: "TOTAL" = both.
  const [sourceFilter, setSourceFilter] = useState<StockLocation>(() => {
    const src = searchParams.get("source");
    return openedFromHistory &&
      (src === "ONLINE" || src === "OFFLINE" || src === "TOTAL")
      ? src
      : "TOTAL";
  });
  // Which location a CSV import goes into when the filter shows both.
  const [importLocation, setImportLocation] = useState<CountLocation>("ONLINE");
  const csvLocation: CountLocation =
    sourceFilter === "TOTAL" ? importLocation : sourceFilter;
  const showOffline = sourceFilter !== "ONLINE";
  const showOnline = sourceFilter !== "OFFLINE";
  /// The reason(s) recorded for a row in the locations on screen.
  const remarksOf = (r: AuditRow): string =>
    visibleLocations
      .map((l) => r.entries[l].remarks?.trim())
      .filter((t): t is string => !!t)
      .join(" / ");
  const visibleLocations: CountLocation[] = [
    ...(showOffline ? (["OFFLINE"] as const) : []),
    ...(showOnline ? (["ONLINE"] as const) : []),
  ];

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
  // Result of a paste or a Zero all - a short timed toast, unlike `error`
  // (which stays until dismissed).
  const [notice, setNotice] = useState<{
    message: string;
    detail?: string;
    variant: ToastVariant;
  } | null>(null);
  // Right-click a category row to recolor it (per browser, purely visual).
  const { getColor: getCategoryColor, setColor: setCategoryColor } =
    useCategoryColors("audit");
  const [catMenu, setCatMenu] = useState<CategoryMenuTarget | null>(null);
  const [zoom, setZoom] = useZoom("manual-count");
  const [query, setQuery] = useState("");
  const [categoryFilter, setCategoryFilter] = useState("");
  // Which rows the grid shows: everything, only counts with a non-zero
  // variance, or only the ones staged but not yet saved.
  const [rowFilter, setRowFilter] = useState<"all" | "flagged" | "changed">(
    "all",
  );
  const [showClearConfirm, setShowClearConfirm] = useState(false);
  const [showPublishConfirm, setShowPublishConfirm] = useState(false);
  const [publishing, setPublishing] = useState(false);
  // Publishing is the supervisor's approval step; encoders see the state only.
  const canPublish = useAuth().user?.role === "SUPERVISOR_ADMIN";
  // Undo / redo over the staged (unsaved) counts. A step is one cell edit (all
  // the keystrokes between focusing a count and leaving it), one Zero all, one
  // paste or one Clear - whole-sheet snapshots, so any of them undoes cleanly.
  // Not persisted: like any undo stack it belongs to this editing session.
  const [past, setPast] = useState<DraftSnapshot[]>([]);
  const [future, setFuture] = useState<DraftSnapshot[]>([]);
  // Whether the cell being edited has already put its step on the stack.
  const editStepPushed = useRef(false);
  // The product whose Variance details panel is open.
  const [detailsProductId, setDetailsProductId] = useState<number | null>(null);
  const navigate = useNavigate();
  const [saving, setSaving] = useState(false);
  // Real per-item percent for LoadingOverlay's ring (see handleSaveAll) - same
  // overlay Online/Offline Entry and CSV import use, so all saves look alike.
  const [savePercent, setSavePercent] = useState(0);
  const [showConfirm, setShowConfirm] = useState(false);
  const realtimeVersion = useRealtimeVersion();
  const progress = useTopProgress();

  useResetOnKeyChange(`${date}:${shift}`, () => {
    setGridRows(null);
    // Not cleared: whichever date/shift is being left keeps what it had
    // staged (still there if switched back to) and the one being loaded
    // picks up whatever it already had staged.
    setDrafts(loadDrafts(date, shift));
    // A different sheet: its edits are not reachable from this one's history.
    setPast([]);
    setFuture([]);
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

  /// This product's last-SAVED count at one location, or null when nothing
  /// has been counted there yet. Read off `gridRows` (the server's rows), not
  /// the drafts overlaid on top of them.
  function savedCountOf(loc: CountLocation, productId: number): number | null {
    const raw = gridRows?.[loc].find((r) => r.product.id === productId)?.entry
      .manualCount;
    return raw === null || raw === undefined ? null : Number(raw);
  }

  /// Whether a staged draft would actually change anything (see
  /// utils/manualCountDrafts.ts - "" means clear when there is something
  /// saved, and nothing at all when there isn't).
  function isRealChange(loc: CountLocation, productId: number, draft: string) {
    return isRealDraftChange(draft, savedCountOf(loc, productId));
  }

  const pendingCount = COUNT_LOCATIONS.reduce(
    (n, loc) =>
      n +
      Object.entries(drafts[loc]).filter(([id, draft]) =>
        isRealChange(loc, Number(id), draft),
      ).length,
    0,
  );

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

  /// Stages many counts at once (paste, Zero all). Like a typed count, each
  /// is only a draft until Save, and it detaches the cell from any CSV import
  /// batch it came from (a hand edit must never be reverted with the import).
  function setDraftMany(
    edits: { loc: CountLocation; productId: number; value: string }[],
  ) {
    if (edits.length === 0) return;
    setDrafts((d) => {
      const next: Drafts = { ONLINE: { ...d.ONLINE }, OFFLINE: { ...d.OFFLINE } };
      for (const e of edits) next[e.loc][e.productId] = e.value;
      return next;
    });
    setImportedBatchByProduct((prev) => {
      const next = { ONLINE: { ...prev.ONLINE }, OFFLINE: { ...prev.OFFLINE } };
      for (const e of edits) delete next[e.loc][e.productId];
      return next;
    });
  }

  const snapshot = (): DraftSnapshot => ({ drafts, batches: importedBatchByProduct });

  /// Records the state about to be replaced, so Undo can put it back. A new
  /// edit also discards whatever had been undone (the usual undo-stack rule).
  function pushHistory() {
    setPast((p) => [...p, snapshot()].slice(-HISTORY_LIMIT));
    setFuture([]);
  }

  function undo() {
    const current = snapshot();
    // Skip steps that would change nothing (an edit that ended where it began).
    let i = past.length - 1;
    while (i >= 0 && sameSnapshot(past[i], current)) i--;
    if (i < 0) {
      setPast([]);
      return;
    }
    const previous = past[i];
    setPast(past.slice(0, i));
    setFuture((f) => [current, ...f].slice(0, HISTORY_LIMIT));
    setDrafts(previous.drafts);
    setImportedBatchByProduct(previous.batches);
  }

  function redo() {
    const next = future[0];
    if (!next) return;
    setFuture((f) => f.slice(1));
    setPast((p) => [...p, snapshot()].slice(-HISTORY_LIMIT));
    setDrafts(next.drafts);
    setImportedBatchByProduct(next.batches);
  }
  // Ctrl+Z / Ctrl+Shift+Z / Ctrl+Y while not typing in a field.
  useUndoRedoKeys(undo, redo, !saving);

  /// When a cell is left, a draft that changes nothing (a cleared 0, or the
  /// saved figure retyped) is dropped so the cell shows what is saved again
  /// instead of sitting blank while Save says there is nothing to save.
  function settleDraft(loc: CountLocation, productId: number) {
    const draft = drafts[loc][productId];
    if (draft === undefined || isRealChange(loc, productId, draft)) return;
    setDrafts((d) => {
      const next = { ...d[loc] };
      delete next[productId];
      return { ...d, [loc]: next };
    });
  }

  /// Discards every staged-but-unsaved count on this sheet (both locations).
  /// Releases this sheet's saved counts to the next shift's opening stock.
  async function handlePublish() {
    setPublishing(true);
    setError(null);
    try {
      const { published } = await publishManualCounts(date, shift);
      setShowPublishConfirm(false);
      setNotice({
        message: `Published ${published} count${published === 1 ? "" : "s"} - they are now the next shift's opening stock`,
        variant: "success",
      });
      // The server broadcasts the change; re-read now so the badge and button
      // do not wait for it.
      const [ONLINE, OFFLINE] = await Promise.all([
        getManualCountGrid(date, shift, "ONLINE"),
        getManualCountGrid(date, shift, "OFFLINE"),
      ]);
      setGridRows({ ONLINE, OFFLINE });
    } catch (e) {
      setShowPublishConfirm(false);
      setError(e instanceof Error ? e.message : "Could not publish");
    } finally {
      setPublishing(false);
    }
  }

  function clearDrafts() {
    pushHistory();
    setDrafts({ ONLINE: {}, OFFLINE: {} });
    setImportedBatchByProduct({ ONLINE: {}, OFFLINE: {} });
    setShowClearConfirm(false);
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
    setSavePercent(0);
    // Close the confirm dialog now so only the percent overlay is on screen
    // while the save runs (same as Online/Offline Entry).
    setShowConfirm(false);
    const totalToSave = pendingCount;
    let processed = 0;
    const failed: string[] = [];
    const succeeded: { loc: CountLocation; productId: number }[] = [];
    for (const loc of COUNT_LOCATIONS) {
      for (const [productIdStr, draft] of Object.entries(drafts[loc])) {
        const productId = Number(productIdStr);
        // An empty draft on a cell that was never counted is not a change -
        // drop it without a round trip.
        if (!isRealChange(loc, productId, draft)) {
          succeeded.push({ loc, productId });
          continue;
        }
        processed++;
        setSavePercent(Math.round((processed / totalToSave) * 100));
        // An empty draft on a cell that HAS a saved count means "remove this
        // count", which the endpoint expresses as manualCount: null (the
        // controller routes that to deleteManualCount). This used to be
        // skipped entirely: the draft was dropped, the cell snapped back to
        // the old figure, and the count stayed in the database still driving
        // the variance - a cleared audit count that silently never cleared.
        const action = draftAction(draft, savedCountOf(loc, productId));
        try {
          const saved = await saveManualCount(
            productId,
            date,
            shift,
            loc,
            action.kind === "set" ? action.value : null,
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
    // What was staged is now (mostly) saved, so earlier steps no longer apply.
    setPast([]);
    setFuture([]);
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
          breaks: { ONLINE: on.openingBreak ?? null, OFFLINE: off?.openingBreak ?? null },
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
  const hasStagedCount = (r: AuditRow) =>
    COUNT_LOCATIONS.some(
      (loc) =>
        drafts[loc][r.product.id] !== undefined &&
        isRealChange(loc, r.product.id, drafts[loc][r.product.id]),
    );
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
  // Clearing a count is a change like any other and has to appear here -
  // this used to filter empty drafts out, so a cleared cell showed up in the
  // Save count but not in the dialog meant to list exactly what Save writes.
  const pendingChanges = COUNT_LOCATIONS.flatMap((loc) =>
    Object.entries(drafts[loc])
      .filter(([productIdStr, draft]) =>
        isRealChange(loc, Number(productIdStr), draft),
      )
      .map(([productIdStr, draft]) => {
        const productId = Number(productIdStr);
        const row = auditRows?.find((r) => r.product.id === productId);
        // Same decision the save loop makes, from the same module - the two
        // cannot disagree about whether a row is a clear or a set.
        const cleared =
          draftAction(draft, savedCountOf(loc, productId)).kind === "clear";
        return {
          key: `${loc}-${productId}`,
          name: row?.product.name ?? `#${productId}`,
          location: LOCATION_LABEL[loc],
          oldValue: row?.entries[loc].manualCount ?? "—",
          newValue: draft,
          cleared,
        };
      }),
  );
  const flaggedCount = auditRows?.filter(isFlagged).length ?? 0;
  // Saved counts on this sheet, across both locations whatever the view shows:
  // publishing releases the whole sheet, not just what is on screen.
  const savedCounts = COUNT_LOCATIONS.flatMap((loc) =>
    (gridRows?.[loc] ?? []).filter((r) => r.isSaved),
  );
  const unpublishedCount = savedCounts.filter((r) => !r.entry.publishedAt).length;

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
      (categoryFilter === "" || r.product.category === categoryFilter) &&
      (rowFilter === "all" ||
        (rowFilter === "flagged" ? isFlagged(r) : hasStagedCount(r))),
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
  // Categories holding a staged count stay open whatever this says (see
  // `hasPending` in the table), so "collapse all" hides only what is safe to.
  const anyExpanded = [...groupedRows.keys()].some((c) => expandedOverride[c]);
  function setAllExpanded(expanded: boolean) {
    setExpandedOverride(
      Object.fromEntries([...groupedRows.keys()].map((c) => [c, expanded])),
    );
  }

  // Column order: the count inputs, then their Total, then Variance last.
  const headers = [
    "SKU",
    "Product",
    "System Remaining",
    ...(showOffline ? ["Offline Count"] : []),
    ...(showOnline ? ["Online Count"] : []),
    "Total Count",
    "Variance",
    "Remarks",
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

  /// Zero all: stage a count of 0 in every visible location column for every
  /// row of one category - a product line that simply wasn't stocked. Goes
  /// through the usual draft/Save step, so nothing is written until confirmed.
  function zeroCategory(category: string) {
    const ids = (groupedRows.get(category) ?? []).map((r) => r.product.id);
    const locs = COUNT_LOCATIONS.filter((l) =>
      l === "ONLINE" ? showOnline : showOffline,
    );
    pushHistory();
    setDraftMany(
      ids.flatMap((productId) =>
        locs.map((loc) => ({ loc, productId, value: "0" })),
      ),
    );
    setNotice({
      message: `${category}: ${ids.length * locs.length} count${ids.length * locs.length === 1 ? "" : "s"} set to 0 (not saved yet)`,
      variant: "info",
    });
  }

  /// Ctrl+V of a spreadsheet block, anchored at the focused count cell (see
  /// utils/manualCountPaste.ts). A single cell is left to the browser.
  function handlePaste(e: React.ClipboardEvent<HTMLTableElement>) {
    const cell =
      document.activeElement instanceof HTMLElement
        ? document.activeElement.getAttribute("data-cell")
        : null;
    const m = cell ? /^manual-count-(ONLINE|OFFLINE)-(\d+)$/.exec(cell) : null;
    if (!m) return;
    const outcome = planCountPaste(
      e.clipboardData.getData("text/plain"),
      { loc: m[1] as CountLocation, productId: Number(m[2]) },
      (visibleRows ?? []).map((r) => ({
        productId: r.product.id,
        name: r.product.name,
      })),
      // On-screen order: Offline first, then Online.
      (["OFFLINE", "ONLINE"] as CountLocation[]).filter((l) =>
        l === "ONLINE" ? showOnline : showOffline,
      ),
      (loc, productId) => {
        const draft = drafts[loc][productId];
        if (draft !== undefined) return draft === "" ? undefined : Number(draft);
        return savedCountOf(loc, productId) ?? undefined;
      },
    );
    if (!outcome) return;
    e.preventDefault();
    pushHistory();
    setDraftMany(
      outcome.edits.map((x) => ({ ...x, value: String(x.value) })),
    );
    setNotice({
      message: outcome.message,
      detail: outcome.detail,
      variant: outcome.variant,
    });
  }

  // PDF of the table exactly as filtered on screen (same columns), built from
  // the row data like every other PDF in the app.
  // Opened from Audit History: build the PDF once the counts for that
  // date/shift have loaded. Not recorded again - it is already in the history.
  useEffect(() => {
    if (!visibleRows || !printAfterLoad.current) return;
    printAfterLoad.current = false;
    if (pendingCount > 0) {
      setError("Save your changes first - the PDF reflects only saved counts.");
      return;
    }
    void handlePdf(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visibleRows]);

  async function handlePdf(record = true) {
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
      if (record) {
        // Best effort - a failed history write must never read as a failed
        // PDF (see api/reportHistory.ts).
        const params = new URLSearchParams({
          history: "1",
          date,
          shift,
          source: sourceFilter,
        });
        recordReportHistory({
          type: "Audit Report",
          scope: date,
          route: `/manual-count?${params}`,
          section:
            sourceFilter === "ONLINE"
              ? "online"
              : sourceFilter === "OFFLINE"
                ? "offline"
                : "all",
        }).catch(() => {});
      }
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
            <Button
              type="button"
              variant="secondary"
              size="sm"
              onClick={() => setAllExpanded(!anyExpanded)}
              disabled={!auditRows}
              aria-label={
                anyExpanded ? "Collapse every category" : "Expand every category"
              }
              title={
                anyExpanded ? "Collapse every category" : "Expand every category"
              }
              className="ae-tap-target ae-toolbar-icon-btn ae-toolbar-collapse-btn"
            >
              {anyExpanded ? <CollapseAllIcon /> : <ExpandAllIcon />}
            </Button>
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
            <Dropdown
              aria-label="Filter rows"
              value={rowFilter}
              onChange={(v) => setRowFilter(v as typeof rowFilter)}
              options={[
                { value: "all", label: "All rows" },
                {
                  value: "flagged",
                  label: flaggedCount
                    ? `Flagged only (${flaggedCount})`
                    : "Flagged only",
                  title: "Only counts whose variance is not zero",
                },
                {
                  value: "changed",
                  label: pendingCount
                    ? `Only changed (${pendingCount})`
                    : "Only changed",
                  title: "Only counts staged but not saved yet",
                },
              ]}
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
            {pendingCount > 0 && (
              <span className="ae-unsaved-badge" aria-live="polite">
                {pendingCount} unsaved change{pendingCount === 1 ? "" : "s"}
              </span>
            )}
            {(past.length > 0 || future.length > 0) && (
              <Button
                className="ae-toolbar-save"
                type="button"
                variant="secondary"
                size="sm"
                onClick={undo}
                disabled={past.length === 0 || saving}
                title="Undo the last staged edit (Ctrl+Z)"
              >
                <UndoIcon />
                <span className="ae-toolbar-btn-label">Undo</span>
              </Button>
            )}
            {savedCounts.length > 0 && (
              <span
                className="ae-unsaved-badge"
                style={unpublishedCount === 0 ? { color: colors.subtleInk } : undefined}
                title={
                  unpublishedCount === 0
                    ? "These counts are the next shift's opening stock"
                    : "Saved counts only become the next shift's opening stock once published"
                }
              >
                {unpublishedCount === 0 ? "Published" : `${unpublishedCount} unpublished`}
              </span>
            )}
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
              onClick={() => setShowClearConfirm(true)}
              disabled={pendingCount === 0 || saving}
              title="Discard unsaved counts on this sheet"
            >
              <ClearIcon />
              <span className="ae-toolbar-btn-label">Clear</span>
            </Button>
            <Button
              className="ae-toolbar-save"
              type="button"
              variant="secondary"
              size="sm"
              onClick={() => void handlePdf()}
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
            {canPublish && (
              <Button
                className="ae-toolbar-save"
                type="button"
                variant="secondary"
                size="sm"
                onClick={() => setShowPublishConfirm(true)}
                disabled={pendingCount > 0 || unpublishedCount === 0 || publishing || saving}
                title={
                  pendingCount > 0
                    ? "Save your changes first"
                    : unpublishedCount === 0
                      ? "Nothing to publish - every saved count is already published"
                      : "Publish the saved counts: they become the next shift's opening stock"
                }
              >
                <PublishIcon />
                <span className="ae-toolbar-btn-label">Publish</span>
              </Button>
            )}
            <Button
              className="ae-toolbar-save"
              type="button"
              variant="secondary"
              size="sm"
              onClick={() => navigate(`/variance-report?date=${date}`)}
              disabled={pendingCount > 0}
              title={
                pendingCount > 0
                  ? "Save your counts first - the report only reads saved data"
                  : "Open the Variance Report for this date"
              }
            >
              <ReportIcon />
              <span className="ae-toolbar-btn-label">Report</span>
            </Button>
            <Link
              to="/audit-history"
              className="ae-btn ae-btn-secondary ae-btn-sm ae-toolbar-save"
              style={{ textDecoration: "none" }}
              title="Previously downloaded Audit sheets"
            >
              <HistoryIcon />
              <span className="ae-toolbar-btn-label">History</span>
            </Link>
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
      {catMenu && (
        <CategoryColorMenu
          target={catMenu}
          color={getCategoryColor(catMenu.category)}
          customColor={getCategoryColor(catMenu.category) !== undefined}
          onColorChange={setCategoryColor}
          onClose={() => setCatMenu(null)}
        />
      )}
      <Toast
        message={error}
        onDismiss={() => setError(null)}
        variant="error"
        duration={null}
      />
      <Toast
        message={notice?.message ?? null}
        title={notice?.detail}
        onDismiss={() => setNotice(null)}
        variant={notice?.variant ?? "info"}
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
            <table
              className="ae-table ae-table--center-head ae-table--compact"
              onPaste={handlePaste}
            >
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
                            style={(() => {
                              const c = getCategoryColor(category);
                              return c
                                ? { background: c, color: inkFor(c) }
                                : undefined;
                            })()}
                            onContextMenu={(e) => {
                              e.preventDefault();
                              setCatMenu({
                                category,
                                x: e.clientX,
                                y: e.clientY,
                              });
                            }}
                          >
                            <span className="ae-cat-label">
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
                            </span>
                            {/* A sibling-style click target inside the bar (a
                                real button can't nest in a button); it stops
                                propagation so zeroing doesn't also collapse. */}
                            <span
                              role="button"
                              tabIndex={0}
                              className="ae-cat-zero no-print"
                              title={`Stage a count of 0 for every product in ${category}`}
                              onClick={(e) => {
                                e.stopPropagation();
                                zeroCategory(category);
                              }}
                              onKeyDown={(e) => {
                                if (e.key !== "Enter" && e.key !== " ") return;
                                e.stopPropagation();
                                e.preventDefault();
                                zeroCategory(category);
                              }}
                            >
                              Zero all
                            </span>
                          </button>
                        </td>
                      </tr>
                      {groupRows.map((r) => {
                        const f = liveFigures(r);
                        const countCell = (loc: CountLocation) => (
                          <td key={loc}>
                            <NumberCellInput
                              data-cell={`manual-count-${loc}-${r.product.id}`}
                              value={String(
                                drafts[loc][r.product.id] ??
                                  r.entries[loc].manualCount ??
                                  "",
                              )}
                              onChange={(v) => {
                                if (!editStepPushed.current) {
                                  pushHistory();
                                  editStepPushed.current = true;
                                }
                                setDraft(loc, r.product.id, v);
                              }}
                              onFocus={() => {
                                editStepPushed.current = false;
                              }}
                              onBlur={() => settleDraft(loc, r.product.id)}
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
                              {visibleLocations.some((l) => r.breaks[l]) && (
                                <span
                                  className="no-print"
                                  style={{ marginLeft: 4, color: colors.warningText, cursor: "help" }}
                                  title={visibleLocations
                                    .filter((l) => r.breaks[l])
                                    .map(
                                      (l) =>
                                        `${LOCATION_LABEL[l]}: opening stock is ${r.breaks[l]!.actual.toLocaleString()} but the previous period carries forward ${r.breaks[l]!.expected.toLocaleString()} (set by an import)`,
                                    )
                                    .join("\n")}
                                  aria-label="Opening stock does not carry forward"
                                >
                                  ⚠
                                </span>
                              )}
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
                            {/* Only where there is something to explain: a
                                saved count that does not match the system.
                                The button opens the details panel, where the
                                reason is written; a recorded reason shows here. */}
                            <td className="ae-remarks-cell">
                              {f.variance !== null &&
                                f.variance !== 0 &&
                                visibleLocations.some((l) => r.saved[l]) && (
                                  <span className="ae-remarks-inner">
                                    <button
                                      type="button"
                                      className="ae-variance-details-btn no-print"
                                      onClick={() => setDetailsProductId(r.product.id)}
                                      aria-label={`Variance details for ${r.product.name}`}
                                      title="Who counted, what moved, who changed what - and why it differs"
                                    >
                                      {remarksOf(r) ? "✎" : "ⓘ"}
                                    </button>
                                    {remarksOf(r) && (
                                      <span className="ae-remarks-text" title={remarksOf(r)}>
                                        {remarksOf(r)}
                                      </span>
                                    )}
                                  </span>
                                )}
                            </td>
                          </tr>
                        );
                      })}
                      <tr className="ae-row-subtotal">
                        <td colSpan={2}>Subtotal - {category}</td>
                        {renderTotals(groupRows)}
                        <td />
                      </tr>
                    </Fragment>
                  );
                })}
                <tr className="ae-row-grand">
                  <td colSpan={2}>GRAND TOTAL</td>
                  {renderTotals(visibleRows ?? [])}
                  <td />
                </tr>
              </tbody>
            </table>
          </RowGlowScroll>
        </div>
      )}
      {detailsProductId !== null && (
        <VarianceDetails
          productId={detailsProductId}
          productName={
            auditRows?.find((r) => r.product.id === detailsProductId)?.product.name ?? ""
          }
          sku={auditRows?.find((r) => r.product.id === detailsProductId)?.product.sku ?? null}
          date={date}
          shift={shift}
          locations={visibleLocations}
          canEdit
          onClose={() => setDetailsProductId(null)}
          onRemarksSaved={(loc, remarks) =>
            setGridRows((prev) =>
              prev
                ? {
                    ...prev,
                    [loc]: prev[loc].map((row) =>
                      row.product.id === detailsProductId ? { ...row, entry: { ...row.entry, remarks } } : row,
                    ),
                  }
                : prev,
            )
          }
        />
      )}
      {showPublishConfirm && (
        <ConfirmDialog
          title="Publish these counts?"
          confirmLabel={`Publish ${unpublishedCount}`}
          busy={publishing}
          onConfirm={() => void handlePublish()}
          onCancel={() => setShowPublishConfirm(false)}
        >
          {unpublishedCount} saved count{unpublishedCount === 1 ? "" : "s"} for{" "}
          {formatDateDisplay(date)} · {SHIFT_SHORT_LABELS[shift]} Shift will become
          the next shift&apos;s opening stock, and any later sheet already saved is
          re-calculated from them. Changing a count afterwards takes it back to
          unpublished until you publish again.
        </ConfirmDialog>
      )}
      {showClearConfirm && (
        <ConfirmDialog
          title="Discard unsaved counts?"
          confirmLabel="Discard"
          onConfirm={clearDrafts}
          onCancel={() => setShowClearConfirm(false)}
        >
          {pendingCount} unsaved count{pendingCount === 1 ? "" : "s"} on this
          sheet will be thrown away. Saved counts are not affected.
        </ConfirmDialog>
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
            // Own bounded scroll box (ae-table-wrap) so the sticky header
            // tracks this table's columns instead of the whole dialog's
            // scroll - without it the header floated mid-list over the rows.
            <div
              className="ae-table-wrap"
              style={{ maxHeight: "50vh", overflowY: "auto" }}
            >
              <table className="ae-table" style={{ minWidth: 0 }}>
                <thead>
                  <tr>
                    <th style={{ textAlign: "left" }}>SKU</th>
                    <th style={{ textAlign: "left" }}>Location</th>
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
                      {/* A clear has no new figure to show, and a blank cell
                          here would read as "nothing happens to this row" -
                          the opposite of what Save is about to do. */}
                      <td
                        style={{
                          fontWeight: 700,
                          color: c.cleared ? colors.danger : colors.yellow,
                        }}
                      >
                        {c.cleared ? "Cleared" : c.newValue}
                      </td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr>
                    <td
                      colSpan={2}
                      style={{
                        textAlign: "left",
                        fontWeight: 700,
                        color: colors.ink,
                        position: "sticky",
                        bottom: 0,
                        background: colors.paperAlt,
                      }}
                    >
                      Total ({pendingChanges.length} count
                      {pendingChanges.length === 1 ? "" : "s"})
                    </td>
                    <td
                      style={{
                        fontWeight: 700,
                        position: "sticky",
                        bottom: 0,
                        background: colors.paperAlt,
                      }}
                    >
                      {pendingChanges
                        .reduce(
                          (sum, c) =>
                            sum +
                            (typeof c.oldValue === "number" ? c.oldValue : 0),
                          0,
                        )
                        .toLocaleString()}
                    </td>
                    <td
                      style={{
                        fontWeight: 700,
                        color: colors.yellow,
                        position: "sticky",
                        bottom: 0,
                        background: colors.paperAlt,
                      }}
                    >
                      {pendingChanges
                        .reduce((sum, c) => sum + Number(c.newValue), 0)
                        .toLocaleString()}
                    </td>
                  </tr>
                </tfoot>
              </table>
            </div>
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
      {saving && (
        <LoadingOverlay label="Saving changes…" percent={savePercent} />
      )}
    </div>
  );

  // Subtotal / grand-total cells for a set of rows, in column order.
  function renderTotals(list: AuditRow[]) {
    const variance = sumLive(list, "variance");
    return (
      <>
        <td>{sumLive(list, "system").toLocaleString()}</td>
        {showOffline && <td>{sumLive(list, "offline").toLocaleString()}</td>}
        {showOnline && <td>{sumLive(list, "online").toLocaleString()}</td>}
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

// Column color coding for the count grid: Variance in teal, the Total in the
// brand gold. The two count input columns (Offline / Online) are left
// uncolored. Header-only, fixed fills with brand-ink labels so they read the
// same in light and dark mode.
const manualCountHeadStyle: Record<string, CSSProperties | undefined> = {
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
const manualCountTint: Record<"Variance" | "Total", CSSProperties> = {
  Variance: tintLayer("#2DB7A8"),
  Total: tintLayer("#F5C000"),
};
