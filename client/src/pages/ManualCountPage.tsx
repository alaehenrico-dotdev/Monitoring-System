import { useBusyAction } from "../hooks/useBusyAction";
import {
  Fragment,
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent,
} from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import {
  CategoryColorMenu,
  type CategoryMenuTarget,
} from "../components/CategoryColorMenu";
import { inkFor, useCategoryColors } from "../hooks/useColumnColors";
import {
  getAuditSnapshot,
  getManualCountGrid,
  publishManualCounts,
  saveManualCount,
} from "../api/manualCounts";
import { loadHistory, saveHistory } from "../utils/sessionHistory";
import { recordReportHistory } from "../api/reportHistory";
import type {
  ManualCountEntry,
  ManualCountGridRow,
  StockLocation,
} from "../types";
import { Button, NumberCellInput } from "../components/ui";
import { useZoom, zoomStyle, ZoomControl } from "../components/ZoomControl";
import { VersionHistoryPanel } from "../components/VersionHistoryPanel";
import { CsvTools } from "../components/CsvTools";
import { BarButton, PageToolbar } from "../components/PageToolbar";
import { FilterSlot } from "../components/FilterSlot";
import { SaveStatus, type SaveState } from "../components/SaveStatus";
import { DateStepper } from "../components/DateStepper";
import { SplitButton } from "../components/SplitButton";
import type { MenuDef } from "../components/MenuBar";
import { zoomSection } from "../utils/zoomMenu";
import { fitWidthItem } from "../utils/fitWidthMenu";
import { useFitWidth } from "../hooks/useFitWidth";
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
  ReorderIcon,
  ReportIcon,
  SaveIcon,
  UndoIcon,
  PublishIcon,
} from "../components/icons";
import { ConfirmDialog } from "../components/ConfirmDialog";
import { VarianceDetails } from "../components/VarianceDetails";
import { Dropdown } from "../components/Dropdown";
import { Modal } from "../components/Modal";
import { SaveSummary } from "../components/SaveSummary";
import { saveNotices } from "../utils/saveReview";
import { LoadingOverlay } from "../components/Spinner";
import { matchesSearch } from "../utils/search";
import { planCountPaste } from "../utils/manualCountPaste";
import {
  draftAction,
  isRealChange as isRealDraftChange,
} from "../utils/manualCountDrafts";
import { formatDateDisplay } from "../utils/dateFormat";
import { downloadTablePdf } from "../utils/tablePdf";
import { auditSnapshotPdf } from "../utils/auditSnapshot";
import { pdfFileName, stockGridSection } from "../utils/pdfTables";
import { coerceShift, getCurrentShiftAndDate, getDefaultAuditSheet, isWholeDayMode, shiftWithWord } from "../utils/shift";
import { colors } from "../theme";
import { RowGlowScroll } from "../components/RowGlowScroll";
import { GridSelectionBar } from "../components/GridSelectionBar";
import { copyRowsToClipboard, useRowSelection } from "../hooks/useRowSelection";
import { toTsv } from "../utils/rowSelection";
import { TableSkeleton } from "../components/Skeleton";
import type { Shift } from "../types";
import { useResetOnKeyChange } from "../hooks/useResetOnKeyChange";
import { useRealtimeVersion } from "../context/RealtimeContext";
import { useUndoRedoKeys } from "../hooks/useGridView";
import { ReorderProductsDialog } from "../components/ReorderProductsButton";
import { useAuth } from "../context/AuthContext";
import { useTopProgress } from "../hooks/useTopProgress";
import { useCategoryReveal } from "../hooks/useCategoryReveal";
import { useRecentCells } from "../hooks/useRecentCells";
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
  // server derives from Manual Count - System Remaining.
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

const historyKey = (date: string, shift: Shift) => `manual-count:${date}:${shift}`;

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

/// Which sheet the page was last on (date, shift, location filter). The staged
/// counts themselves are kept per sheet (above), but without this a person who
/// switched to another page and came back landed on the *current* sheet - the
/// one they had been encoding looked empty, as if the entries were lost.
const VIEW_KEY = "ala-eh-manual-count-view";

interface StoredView {
  date: string;
  shift: Shift;
  source: StockLocation;
}

/// The last sheet, but only while it still holds unsaved counts. Once nothing
/// is staged there is nothing to protect, and the page opens on the current
/// shift as it always did (a stale date left over from yesterday would be a
/// trap, not a convenience).
function loadStoredView(): StoredView | null {
  try {
    const raw = sessionStorage.getItem(VIEW_KEY);
    if (!raw) return null;
    const v = JSON.parse(raw) as Partial<StoredView>;
    if (
      typeof v.date !== "string" ||
      !/^\d{4}-\d{2}-\d{2}$/.test(v.date) ||
      (v.shift !== "MORNING" && v.shift !== "NIGHT") ||
      (v.source !== "ONLINE" && v.source !== "OFFLINE" && v.source !== "TOTAL")
    )
      return null;
    const staged = loadDrafts(v.date, v.shift);
    if (Object.keys(staged.ONLINE).length + Object.keys(staged.OFFLINE).length === 0) return null;
    // Shifts off: a remembered Morning sheet cannot be reopened.
    if (isWholeDayMode() && v.shift === "MORNING") return null;
    return { date: v.date, shift: v.shift, source: v.source };
  } catch {
    return null;
  }
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
  /// Every counted (or staged) location in view is an opening balance - the
  /// first count of the product there, which seeds the system and has no variance.
  opening: boolean;
}

/// The saved count's id in the change log. Read structurally (the API row carries
/// it, ManualCountEntry doesn't declare it) and only meaningful for a saved row.
function countRecordId(entry: ManualCountEntry): number | undefined {
  const id = (entry as { id?: unknown }).id;
  return typeof id === "number" ? id : undefined;
}

/// Published counts are final, so the sheet shows their cells blank, ready for
/// the next audit - on every load, not just right after the Publish click. They
/// stay stored (variance reports and the carry-forward read them), and Audit
/// History reopens them from the frozen copy each publish saved.
function blankPublished(rows: ManualCountGridRow[]): ManualCountGridRow[] {
  return rows.map((r) =>
    r.entry.publishedAt
      ? { ...r, isSaved: false, isFlagged: false, entry: { ...r.entry, manualCount: null, variance: null } }
      : r,
  );
}

/// Section 4.4 - the supervisor (or encoder on duty) enters the physical
/// count at each location; Variance = Count - System Remaining Stock is
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
  // An entry made by a Publish carries the id of the frozen copy it opens; an
  // older entry (made by exporting the sheet) does not, and rebuilds from the
  // live counts as it always did.
  const snapshotParam = Number(searchParams.get("snapshot"));
  const snapshotId = openedFromHistory && Number.isInteger(snapshotParam) && snapshotParam > 0 ? snapshotParam : null;
  const printAfterLoad = useRef(openedFromHistory && snapshotId === null);
  // Read once: coming back to the page resumes the sheet with unsaved counts.
  const [resumed] = useState(() => (openedFromHistory ? null : loadStoredView()));
  const [{ date, shift }, setDateShift] = useState<{
    date: string;
    shift: Shift;
  }>(() => {
    // The audit is done per night, so it opens on a Night sheet.
    const now = getDefaultAuditSheet();
    const d = searchParams.get("date") ?? "";
    const s = searchParams.get("shift");
    if (!openedFromHistory || !/^\d{4}-\d{2}-\d{2}$/.test(d)) return resumed ?? now;
    return { date: d, shift: s === "MORNING" || s === "NIGHT" ? coerceShift(s) : now.shift };
  });
  const setDate = (d: string) => setDateShift((prev) => ({ ...prev, date: d }));
  const setShift = (s: Shift) =>
    setDateShift((prev) => ({ ...prev, shift: s }));
  // Online/Offline encoders only work their own channel, so the page opens on
  // (and stays on) their matching column; only the supervisor can switch.
  const role = useAuth().user?.role;
  const lockedLocation: CountLocation | null =
    role === "ONLINE_ENCODER"
      ? "ONLINE"
      : role === "OFFLINE_ENCODER"
        ? "OFFLINE"
        : null;
  // Which location(s) the table shows/edits: "TOTAL" = both.
  const [sourceFilter, setSourceFilter] = useState<StockLocation>(() => {
    if (lockedLocation) return lockedLocation;
    if (resumed) return resumed.source;
    const src = searchParams.get("source");
    return openedFromHistory &&
      (src === "ONLINE" || src === "OFFLINE" || src === "TOTAL")
      ? src
      : "TOTAL";
  });
  // Which location a CSV import goes into when the filter shows both.
  const [importLocation, setImportLocation] = useState<CountLocation>(
    lockedLocation ?? "ONLINE",
  );
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
  // Fades a category's rows in and out when it is toggled (hooks/useCategoryReveal.ts).
  const reveal = useCategoryReveal();
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
  // Result of a paste or a Clear all - a short timed toast, unlike `error`
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
  const [fit, setFit] = useFitWidth("manual-count");
  const [query, setQuery] = useState("");
  const [categoryFilter, setCategoryFilter] = useState("");
  // Which rows the grid shows: everything, only counts with a non-zero
  // variance, or only the ones staged but not yet saved.
  const [rowFilter, setRowFilter] = useState<"all" | "flagged" | "changed">(
    "all",
  );
  const [showClearConfirm, setShowClearConfirm] = useState(false);
  const [showPublishConfirm, setShowPublishConfirm] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [publishing, setPublishing] = useState(false);
  // Publish-dialog choice: also make the counts the next day's opening stock.
  // Off by default - counts are an audit only unless a supervisor opts in.
  const [applyToOpening, setApplyToOpening] = useState(false);
  // Publishing is the supervisor's approval step; encoders see the state only.
  const canPublish = useAuth().user?.role === "SUPERVISOR_ADMIN";
  // Undo / redo over the staged (unsaved) counts. A step is one cell edit (all
  // the keystrokes between focusing a count and leaving it), one Clear all, one
  // paste or one Clear - whole-sheet snapshots, so any of them undoes cleanly.
  // Not persisted: like any undo stack it belongs to this editing session.
  const [past, setPast] = useState<DraftSnapshot[]>(() => loadHistory<DraftSnapshot>(historyKey(date, shift)).past);
  const [future, setFuture] = useState<DraftSnapshot[]>(() => loadHistory<DraftSnapshot>(historyKey(date, shift)).future);
  // Whether the cell being edited has already put its step on the stack.
  const editStepPushed = useRef(false);
  // The product whose Variance details panel is open.
  const [detailsProductId, setDetailsProductId] = useState<number | null>(null);
  const navigate = useNavigate();
  const [reorderOpen, setReorderOpen] = useState(false);
  const [savedAt, setSavedAt] = useState<number | undefined>(undefined);
  const [saveFailed, setSaveFailed] = useState(false);
  const [saving, setSaving] = useState(false);
  // Real per-item percent for LoadingOverlay's ring (see handleSaveAll) - same
  // overlay Online/Offline Entry and CSV import use, so all saves look alike.
  const [savePercent, setSavePercent] = useState(0);
  const [showConfirm, setShowConfirm] = useState(false);
  const realtimeVersion = useRealtimeVersion();
  // Bumped after the product list changed from an import, so the grid reloads.
  const [productsVersion, setProductsVersion] = useState(0);
  const progress = useTopProgress();

  useResetOnKeyChange(`${date}:${shift}`, () => {
    setGridRows(null);
    // Not cleared: whichever date/shift is being left keeps what it had
    // staged (still there if switched back to) and the one being loaded
    // picks up whatever it already had staged.
    setDrafts(loadDrafts(date, shift));
    // A different sheet: its edits are not reachable from this one's history,
    // and it picks up whatever history it had when it was last left.
    const history = loadHistory<DraftSnapshot>(historyKey(date, shift));
    setPast(history.past);
    setFuture(history.future);
  });
  // The undo/redo history survives switching pages (see utils/sessionHistory.ts).
  useEffect(() => {
    saveHistory(historyKey(date, shift), past, future);
  }, [past, future, date, shift]);
  useEffect(() => {
    // Drop a response for a date/shift (or refetch) that has been superseded.
    let cancelled = false;
    Promise.all([
      getManualCountGrid(date, shift, "ONLINE"),
      getManualCountGrid(date, shift, "OFFLINE"),
    ])
      .then(([ONLINE, OFFLINE]) => {
        if (!cancelled) setGridRows({ ONLINE: blankPublished(ONLINE), OFFLINE: blankPublished(OFFLINE) });
      })
      .catch((e) => {
        if (!cancelled) setError(e.message);
      });
    return () => {
      cancelled = true;
    };
  }, [date, shift, realtimeVersion, productsVersion]);

  // Remember which sheet is open so it can be resumed (see loadStoredView).
  useEffect(() => {
    try {
      const view: StoredView = { date, shift, source: sourceFilter };
      sessionStorage.setItem(VIEW_KEY, JSON.stringify(view));
    } catch {
      // Best effort.
    }
  }, [date, shift, sourceFilter]);

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

  /// Stages many counts at once (paste, Clear all). Like a typed count, each
  /// is only a draft until Save, and it detaches the cell from any CSV import
  /// batch it came from (a hand edit must never be reverted with the import).
  function setDraftMany(
    edits: { loc: CountLocation; productId: number; value: string }[],
  ) {
    if (edits.length === 0) return;
    setDrafts((d) => {
      const next: Drafts = {
        ONLINE: { ...d.ONLINE },
        OFFLINE: { ...d.OFFLINE },
      };
      for (const e of edits) next[e.loc][e.productId] = e.value;
      return next;
    });
    setImportedBatchByProduct((prev) => {
      const next = { ONLINE: { ...prev.ONLINE }, OFFLINE: { ...prev.OFFLINE } };
      for (const e of edits) delete next[e.loc][e.productId];
      return next;
    });
  }

  const snapshot = (): DraftSnapshot => ({
    drafts,
    batches: importedBatchByProduct,
  });

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
  /// Approves this sheet's saved counts, optionally also as the next day's opening stock.
  async function handlePublish() {
    setPublishing(true);
    setError(null);
    try {
      const { published, leftSaved = 0 } = await publishManualCounts(date, shift, applyToOpening);
      setShowPublishConfirm(false);
      setApplyToOpening(false);
      // Later saved days are recalculated by an applied publish. Say when one could
      // not be (a finished day goes to an admin; an imported opening stays), so a
      // day that keeps its old opening is expected rather than mistaken for a miss.
      const left = leftSaved
        ? ` · ${leftSaved} product${leftSaved === 1 ? "" : "s"} ${leftSaved === 1 ? "has" : "have"} a later day that could not be updated (finished and waiting for approval, or an imported opening)`
        : "";
      setNotice({
        message: `Published ${published} count${published === 1 ? "" : "s"} - ${
          applyToOpening ? "now the next day's opening stock" : "now final for reporting"
        }${left}`,
        variant: "success",
      });
      // The server broadcasts the change; re-read now so the badge and button
      // do not wait for it.
      const [ONLINE, OFFLINE] = await Promise.all([
        getManualCountGrid(date, shift, "ONLINE"),
        getManualCountGrid(date, shift, "OFFLINE"),
      ]);
      setGridRows({ ONLINE: blankPublished(ONLINE), OFFLINE: blankPublished(OFFLINE) });
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
    if (failed.length) setError(`Save failed: ${failed.join("; ")}`);
    setSaveFailed(failed.length > 0);
    if (failed.length === 0) setSavedAt(Date.now());
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
          breaks: {
            ONLINE: on.openingBreak ?? null,
            OFFLINE: off?.openingBreak ?? null,
          },
        };
      })
    : null;

  // Counts a user saved glow gold until they are published, like the Online/
  // Offline grids (hooks/useRecentCells.ts), so a reopened sheet shows what was
  // entered last. Only a SAVED row has a change-log record: an unsaved Offline
  // placeholder is a copy of the Online entry and carries its id, so it is left
  // out. Publishing moves no row's updatedAt, hence the realtime version.
  const recentCounts = useRecentCells(
    "manual_counts",
    (auditRows ?? []).flatMap((r) =>
      COUNT_LOCATIONS.map((loc) => ({
        recordId: r.saved[loc] ? countRecordId(r.entries[loc]) : undefined,
        cell: `${loc}:${r.product.id}`,
        version: (r.entries[loc] as { updatedAt?: unknown }).updatedAt,
      })),
    ),
    realtimeVersion,
  );

  // Live figures per row for the current filter: a staged draft overrides the
  // saved count, and its variance is recomputed (Count - System Remaining,
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
    // An opening balance contributes no variance (the server stores it as 0).
    const isOpening = (loc: CountLocation) =>
      r.entries[loc].isOpeningBalance === true;
    let variance: number | null = null;
    if (online !== null)
      variance =
        (variance ?? 0) +
        (isOpening("ONLINE")
          ? 0
          : online - toNum(r.entries.ONLINE.systemRemainingStock));
    if (offline !== null)
      variance =
        (variance ?? 0) +
        (isOpening("OFFLINE")
          ? 0
          : offline - toNum(r.entries.OFFLINE.systemRemainingStock));
    const counted: CountLocation[] = [
      ...(online !== null ? (["ONLINE"] as const) : []),
      ...(offline !== null ? (["OFFLINE"] as const) : []),
    ];
    return {
      opening: counted.length > 0 && counted.every(isOpening),
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
  // Rows whose count in view is an opening balance (saved or staged) - shown
  // as a note above the table so the missing variance is explained.
  const openingCount = (auditRows ?? []).filter(
    (r) => liveFigures(r).opening,
  ).length;
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
  const unpublishedCount = savedCounts.filter(
    (r) => !r.entry.publishedAt,
  ).length;
  // Published counts show blank (see blankPublished), so they are no longer in
  // savedCounts - but the sheet still says it was published.
  const publishedCount = COUNT_LOCATIONS.flatMap((loc) => gridRows?.[loc] ?? []).filter((r) => r.entry.publishedAt).length;
  // Done adding/editing: nothing staged, nothing mid-save, and saved counts
  // are waiting for approval - the toolbar's Publish button glows.
  const publishReady =
    canPublish &&
    unpublishedCount > 0 &&
    pendingCount === 0 &&
    !saving &&
    !publishing;

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

  // ---- Row selection --------------------------------------------------------
  // Excel-style: press the SKU/Product cell to select a row, Shift+press for a
  // range, Ctrl/Cmd+press to add or remove one, or press and drag (see
  // hooks/useRowSelection.ts). Only rows on screen can be selected, so a
  // collapsed category's rows are not part of it (same open/closed rule as the
  // table below: a category holding a staged count is always open).
  const selectableIds = [...groupedRows.entries()].flatMap(([category, groupRows]) =>
    groupRows.some((r) => drafts.ONLINE[r.product.id] !== undefined || drafts.OFFLINE[r.product.id] !== undefined) ||
    expandedOverride[category]
      ? groupRows.map((r) => r.product.id)
      : [],
  );
  const selection = useRowSelection({
    visibleIds: selectableIds,
    onCopy: copySelectedRows,
    onClear: clearSelectedCounts,
  });
  const selectedRows = selection.selected.flatMap((id) => (visibleRows ?? []).find((r) => r.product.id === id) ?? []);
  /// The count columns on screen, in the order they are drawn (Offline first).
  const countColumns = (["OFFLINE", "ONLINE"] as CountLocation[]).filter((l) => (l === "ONLINE" ? showOnline : showOffline));

  /// Fills one count into a location's column for every selected row - staged
  /// as drafts like a typed count, so nothing is written until Save.
  function fillSelectedCounts(loc: string, value: number) {
    pushHistory();
    setDraftMany(selection.selected.map((productId) => ({ loc: loc as CountLocation, productId, value: String(value) })));
    setNotice({
      message: `${loc === "ONLINE" ? "Online" : "Offline"} count set to ${value.toLocaleString()} on ${selection.selected.length} row${selection.selected.length === 1 ? "" : "s"} (not saved yet)`,
      variant: "info",
    });
  }
  /// Back to uncounted for every selected row (an empty draft removes a saved
  /// count on Save - the same as "Clear all" on a category).
  function clearSelectedCounts(ids: number[]) {
    pushHistory();
    setDraftMany(ids.flatMap((productId) => countColumns.map((loc) => ({ loc, productId, value: "" }))));
    setNotice({ message: `${ids.length} row${ids.length === 1 ? "" : "s"} cleared (not saved yet)`, variant: "info" });
  }
  /// The selected rows as tab-separated text, which Excel pastes as a grid.
  function copySelectedRows(ids: number[]) {
    const rows = ids.flatMap((id) => (visibleRows ?? []).find((r) => r.product.id === id) ?? []);
    const cell = (n: number | null) => (n === null ? "" : String(n));
    copyRowsToClipboard(
      toTsv(
        ["SKU", "Product", "System Remaining", ...countColumns.map((l) => (l === "ONLINE" ? "Online Count" : "Offline Count")), "Total Count", "Variance"],
        rows.map((r) => {
          const f = liveFigures(r);
          return [
            r.product.sku ?? "",
            r.product.name,
            String(f.system),
            ...countColumns.map((l) => cell(l === "ONLINE" ? f.online : f.offline)),
            String(f.total),
            cell(f.variance),
          ];
        }),
      ),
      rows.length,
    );
  }
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

  /// Clear all: stage an empty count in every visible location column for every
  /// row of one category. An empty draft means "no count" - on Save it removes a
  /// saved count (and does nothing for a cell never counted), so a cleared row
  /// is uncounted rather than a confirmed zero. Goes through the usual
  /// draft/Save step, so nothing is written until confirmed.
  function clearCategory(category: string) {
    const ids = (groupedRows.get(category) ?? []).map((r) => r.product.id);
    const locs = COUNT_LOCATIONS.filter((l) =>
      l === "ONLINE" ? showOnline : showOffline,
    );
    pushHistory();
    setDraftMany(
      ids.flatMap((productId) =>
        locs.map((loc) => ({ loc, productId, value: "" })),
      ),
    );
    setNotice({
      message: `${category}: ${ids.length * locs.length} count${ids.length * locs.length === 1 ? "" : "s"} cleared (not saved yet)`,
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
        if (draft !== undefined)
          return draft === "" ? undefined : Number(draft);
        return savedCountOf(loc, productId) ?? undefined;
      },
    );
    if (!outcome) return;
    e.preventDefault();
    pushHistory();
    setDraftMany(outcome.edits.map((x) => ({ ...x, value: String(x.value) })));
    setNotice({
      message: outcome.message,
      detail: outcome.detail,
      variant: outcome.variant,
    });
  }

  // PDF of the table exactly as filtered on screen (same columns), built from
  // the row data like every other PDF in the app.
  const pdfAction = useBusyAction();

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
          subtitle: `${formatDateDisplay(date)} - ${shiftWithWord(shift)} - ${FILTER_LABEL[sourceFilter]}`,
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

  // Opened from Audit History: build the PDF once the counts for that
  // date/shift have loaded. Not recorded again - it is already in the history.
  useEffect(() => {
    if (!visibleRows || !printAfterLoad.current) return;
    printAfterLoad.current = false;
    if (pendingCount > 0) {
      // One-shot message for a one-shot trigger (printAfterLoad), not derived state.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setError("Save first. The PDF includes saved counts only.");
      return;
    }
    void handlePdf(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visibleRows]);

  // Opened from Audit History on a published audit: download the frozen copy
  // that Publish saved (both Online and Offline, as released), and put the page
  // on that sheet. Runs once; nothing is recorded again.
  const snapshotOpened = useRef(false);
  useEffect(() => {
    if (snapshotId === null || snapshotOpened.current) return;
    snapshotOpened.current = true;
    getAuditSnapshot(snapshotId)
      .then(async (snapshot) => {
        setDateShift({ date: snapshot.entryDate, shift: snapshot.shift });
        await progress.track(() => downloadTablePdf(auditSnapshotPdf(snapshot)));
      })
      .catch((e) => setError(e instanceof Error ? `Could not open that published audit: ${e.message}` : "Could not open that published audit"));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [snapshotId]);

  const varianceCell = (value: number | null): CSSProperties => ({
    ...manualCountTint.Variance,
    fontWeight: value !== null && value !== 0 ? 700 : 400,
    color: value !== null && value < 0 ? colors.danger : undefined,
  });

  const saveState: SaveState = saving ? "saving" : saveFailed ? "failed" : savedAt !== undefined ? "saved" : "idle";
  const saveReason =
    pendingCount === 0 ? "No changes to save" : saving ? "Saving…" : undefined;
  const publishReason =
    pendingCount > 0
      ? "Save your changes first"
      : unpublishedCount === 0
        ? "Nothing to publish - every saved count is already published"
        : publishing || saving
          ? "Wait for the current save or publish to finish"
          : undefined;
  const manualMenus: MenuDef[] = [
    {
      id: "edit",
      label: "Edit",
      sections: [
        {
          items: [
            {
              id: "undo",
              label: "Undo",
              icon: <UndoIcon />,
              shortcut: "Ctrl+Z",
              disabledReason: saving
                ? "Wait for the save to finish"
                : past.length === 0
                  ? "Nothing to undo"
                  : undefined,
              onSelect: undo,
            },
            {
              id: "clear",
              label: "Clear unsaved counts…",
              icon: <ClearIcon />,
              tone: "danger",
              disabledReason: saving
                ? "Wait for the save to finish"
                : pendingCount === 0
                  ? "No changes to discard"
                  : undefined,
              onSelect: () => setShowClearConfirm(true),
            },
          ],
        },
      ],
    },
    {
      id: "view",
      label: "View",
      sections: [
        {
          items: [
            {
              id: "expand-all",
              label: anyExpanded ? "Collapse all categories" : "Expand all categories",
              icon: anyExpanded ? <CollapseAllIcon /> : <ExpandAllIcon />,
              disabledReason: auditRows ? undefined : "The sheet is still loading",
              onSelect: () => setAllExpanded(!anyExpanded),
            },
            fitWidthItem(fit, setFit),
            {
              id: "reorder",
              label: "Reorder products…",
              icon: <ReorderIcon />,
              disabledReason: canPublish ? undefined : "Only an admin can change the product order",
              onSelect: () => setReorderOpen(true),
            },
            {
              id: "history",
              label: "Audit history…",
              icon: <HistoryIcon />,
              onSelect: () => navigate("/audit-history"),
            },
            {
              id: "version-history",
              label: "Version history",
              icon: <HistoryIcon />,
              disabledReason: canPublish ? undefined : "Only an admin can see version history",
              onSelect: () => setHistoryOpen(true),
            },
          ],
        },
        zoomSection(zoom, setZoom),
      ],
    },
    {
      id: "export",
      label: "Export",
      sections: [
        {
          items: [
            {
              id: "pdf",
              label: "Download PDF",
              icon: <PrinterIcon />,
              disabledReason: pendingCount > 0
                ? "Save your changes first - PDF reflects only saved data"
                : !visibleRows
                  ? "The sheet is still loading"
                  : pdfAction.busy
                    ? "Preparing the PDF…"
                    : undefined,
              onSelect: () => void pdfAction.run(() => handlePdf()),
            },
            {
              id: "report",
              label: "Variance report…",
              icon: <ReportIcon />,
              disabledReason: pendingCount > 0 ? "Save your counts first - the report only reads saved data" : undefined,
              onSelect: () => navigate(`/variance-report?date=${date}`),
            },
          ],
        },
      ],
    },
  ];

  return (
    <div>
      <PageHeader
        title={
          <>
            Manual Counting &amp; Variance - {formatDateDisplay(date)} -{" "}
            {shiftWithWord(shift)} - {FILTER_LABEL[sourceFilter]}
          </>
        }
        subtitle="Review and correct manual counts."
      >
        <PageToolbar
          activeFilters={(query.trim() !== "" ? 1 : 0) + (categoryFilter !== "" ? 1 : 0) + (rowFilter !== "all" ? 1 : 0)}
          onClearFilters={() => {
            setQuery("");
            setCategoryFilter("");
            setRowFilter("all");
          }}
          label="Manual count"
          menus={manualMenus}
          filters={
            <>
              <FilterSlot active={query.trim() !== ""} label="Search">
                <SearchInput
                  value={query}
                  onChange={setQuery}
                  placeholder="Search SKU or category…"
                />
              </FilterSlot>
              <FilterSlot active={categoryFilter !== ""} label="Category">
                <CategoryFilter
                  categories={categories}
                  value={categoryFilter}
                  onChange={setCategoryFilter}
                />
              </FilterSlot>
              <FilterSlot active={rowFilter !== "all"} label="Rows">
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
              </FilterSlot>
              {!lockedLocation && (
                <StockSourceFilter
                  value={sourceFilter}
                  onChange={setSourceFilter}
                />
              )}
              <DateStepper
                value={date}
                onChange={setDate}
                todayValue={getCurrentShiftAndDate().date}
              />
              <ShiftFilter value={shift} onChange={(s) => s && setShift(s)} />
              {flaggedCount > 0 && (
                <span
                  className="ae-mb-flagged"
                  title={`${flaggedCount} product(s) with a non-zero variance`}
                >
                  ⚠ {flaggedCount} flagged
                </span>
              )}
            </>
          }
          actions={
            <>
              {pendingCount > 0 && (
                <span className="ae-unsaved-badge" aria-live="polite">
                  {pendingCount} unsaved change{pendingCount === 1 ? "" : "s"}
                </span>
              )}
              {(savedCounts.length > 0 || publishedCount > 0) && (
                <span
                  className="ae-unsaved-badge"
                  style={
                    unpublishedCount === 0
                      ? { color: colors.subtleInk }
                      : undefined
                  }
                  title={
                    unpublishedCount === 0
                      ? "These counts are approved and final for reporting"
                      : "Saved counts are only final for reporting once a supervisor publishes them"
                  }
                >
                  {unpublishedCount === 0
                    ? "Published"
                    : `${unpublishedCount} unpublished`}
                </span>
              )}
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
                importLocations={
                  lockedLocation ? [lockedLocation] : COUNT_LOCATIONS
                }
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
                canManageProducts={canPublish}
                onProductsChanged={() => setProductsVersion((v) => v + 1)}
                blankAsZero
                showExport={false}
                showPdf={false}
              />
              <SaveStatus state={saveState} savedAt={savedAt} onRetry={() => setShowConfirm(true)} />
              <BarButton
                primary
                icon={<SaveIcon />}
                label={saving ? "Saving…" : `Save${pendingCount > 0 ? ` (${pendingCount})` : ""}`}
                disabledReason={saveReason}
                title="Review and save changes"
                onClick={() => setShowConfirm(true)}
              />
              {canPublish && (
                <SplitButton
                  label="Publish"
                  icon={<PublishIcon />}
                  tone="warn"
                  attention={publishReady}
                  disabledReason={publishReason}
                  title="Publish the saved counts: approve them as final (optionally also as the next day's opening stock)"
                  onClick={() => setShowPublishConfirm(true)}
                  menuLabel="Publish options"
                  items={[]}
                />
              )}
            </>
          }
          trailing={<ZoomControl zoom={zoom} onChange={setZoom} />}
        />
        {historyOpen && canPublish && (
          <VersionHistoryPanel sheet="manual" date={date} shift={shift} onClose={() => setHistoryOpen(false)} />
        )}
        {reorderOpen && canPublish && (
          <ReorderProductsDialog onClose={() => setReorderOpen(false)} />
        )}
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
      {openingCount > 0 && (
        <p
          role="status"
          style={{
            margin: "0 0 10px",
            fontSize: "calc(12.5px * var(--ae-fs, 1))",
            color: colors.subtleInk,
          }}
        >
          {openingCount} first count{openingCount === 1 ? "" : "s"} will be
          recorded as opening balances - they are not counted as variance.
          A count only becomes a shift&apos;s opening stock if you tick the
          option when publishing.
        </p>
      )}
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
          {selection.selected.length > 0 && (
            <GridSelectionBar
              count={selection.selected.length}
              fillTargets={countColumns.map((l) => ({ key: l, label: l === "ONLINE" ? "Online Count" : "Offline Count" }))}
              onFill={fillSelectedCounts}
              onClearCells={() => clearSelectedCounts(selection.selected)}
              clearLabel="Clear counts"
              clearTitle="Put the selected rows back to uncounted (Delete) - nothing is saved until you Save"
              onCopy={() => copySelectedRows(selection.selected)}
              onDeselect={selection.clear}
            />
          )}
          <RowGlowScroll
            focusStorageKey={`ala-eh-focus:manual-count:${date}:${shift}`}
          >
            <table
              className={`ae-table ae-table--center-head ae-table--compact ae-table--pickable${fit ? " ae-table--fit" : ""}`}
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
                              reveal.toggle(category, isExpanded, !hasPending, () =>
                                setExpandedOverride((e) => ({ ...e, [category]: !isExpanded })),
                              )
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
                                  transform:
                                    isCollapsed || reveal.closing(category)
                                      ? "rotate(-90deg)"
                                      : "none",
                                  transition:
                                    "transform 160ms cubic-bezier(0.22, 1, 0.36, 1)",
                                }}
                              >
                                <ChevronIcon />
                              </span>
                              {category}
                            </span>
                            {/* A sibling-style click target inside the bar (a
                                real button can't nest in a button); it stops
                                propagation so clearing doesn't also collapse. */}
                            <span
                              role="button"
                              tabIndex={0}
                              className="ae-cat-zero no-print"
                              title={`Clear every count in ${category}`}
                              onClick={(e) => {
                                e.stopPropagation();
                                clearCategory(category);
                              }}
                              onKeyDown={(e) => {
                                if (e.key !== "Enter" && e.key !== " ") return;
                                e.stopPropagation();
                                e.preventDefault();
                                clearCategory(category);
                              }}
                            >
                              Clear all
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
                              className={
                                drafts[loc][r.product.id] === undefined &&
                                recentCounts.has(`${loc}:${r.product.id}:manualCount`)
                                  ? "ae-input-cell--saved"
                                  : ""
                              }
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
                              style={{ width: "var(--ae-cell-w, 64px)", textAlign: "center" }}
                            />
                          </td>
                        );
                        return (
                          <tr
                            key={r.product.id}
                            data-row-id={r.product.id}
                            className={
                              (isCollapsed
                                ? "ae-cat-row ae-row-collapsed"
                                : "ae-cat-row") +
                              reveal.rowClass(category) +
                              (selection.selectedSet.has(r.product.id)
                                ? " ae-row-selected"
                                : "")
                            }
                            style={
                              isFlagged(r)
                                ? { background: colors.warningBg }
                                : undefined
                            }
                          >
                            <td
                              className="ae-cell-sku ae-row-pick"
                              onMouseDown={(e) => selection.press(e, r.product.id)}
                              onMouseEnter={() => selection.enter(r.product.id)}
                            >
                              {r.product.sku ?? "—"}
                              {visibleLocations.some((l) => r.breaks[l]) && (
                                <span
                                  className="no-print"
                                  style={{
                                    marginLeft: 4,
                                    color: colors.warningText,
                                    cursor: "help",
                                  }}
                                  title={visibleLocations
                                    .filter((l) => r.breaks[l])
                                    .map(
                                      (l) =>
                                        `${LOCATION_LABEL[l]}: opening stock is ${r.breaks[l]!.actual.toLocaleString()} but the previous period carries forward ${r.breaks[l]!.expected.toLocaleString()} (imported)`,
                                    )
                                    .join("\n")}
                                  aria-label="Opening stock does not carry forward"
                                >
                                  ⚠
                                </span>
                              )}
                            </td>
                            <td
                              className="ae-cell-name ae-row-pick"
                              onMouseDown={(e) => selection.press(e, r.product.id)}
                              onMouseEnter={() => selection.enter(r.product.id)}
                              title="Click to select the row - Shift+click for a range, Ctrl+click to add"
                            >
                              {r.product.name}
                            </td>
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
                              {f.variance === null ? (
                                "—"
                              ) : f.opening ? (
                                <span
                                  style={openingTagStyle}
                                  title="First count of this product: it is not counted as a variance. It does not change opening stock."
                                >
                                  Opening
                                </span>
                              ) : (
                                f.variance.toLocaleString()
                              )}
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
                                      onClick={() =>
                                        setDetailsProductId(r.product.id)
                                      }
                                      aria-label={`Variance details for ${r.product.name}`}
                                      title="Who counted, what moved, who changed what - and why it differs"
                                    >
                                      {remarksOf(r) ? "✎" : "ⓘ"}
                                    </button>
                                    {remarksOf(r) && (
                                      <span
                                        className="ae-remarks-text"
                                        title={remarksOf(r)}
                                      >
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
              {selection.selected.length > 0 && (
                // The selection's own totals, pinned to the bottom edge.
                <tfoot className="no-print">
                  <tr className="ae-row-selected-total">
                    <td colSpan={2}>SELECTED ({selection.selected.length})</td>
                    {renderTotals(selectedRows)}
                    <td />
                  </tr>
                </tfoot>
              )}
            </table>
          </RowGlowScroll>
        </div>
      )}
      {detailsProductId !== null && (
        <VarianceDetails
          productId={detailsProductId}
          productName={
            auditRows?.find((r) => r.product.id === detailsProductId)?.product
              .name ?? ""
          }
          sku={
            auditRows?.find((r) => r.product.id === detailsProductId)?.product
              .sku ?? null
          }
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
                      row.product.id === detailsProductId
                        ? { ...row, entry: { ...row.entry, remarks } }
                        : row,
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
          onCancel={() => {
            setShowPublishConfirm(false);
            setApplyToOpening(false);
          }}
        >
          {unpublishedCount} saved count{unpublishedCount === 1 ? "" : "s"} for{" "}
          {formatDateDisplay(date)} · {shiftWithWord(shift)} will be
          approved as final for reporting. Changing a count afterwards takes it
          back to unpublished until you publish again.
          <label
            style={{ display: "flex", gap: 8, alignItems: "flex-start", marginTop: 12 }}
          >
            <input
              type="checkbox"
              checked={applyToOpening}
              disabled={publishing}
              onChange={(e) => setApplyToOpening(e.target.checked)}
              style={{ marginTop: 3 }}
            />
            <span>
              Also use these counts as the next day&apos;s opening stock
              <span style={{ display: "block", fontSize: "calc(12px * var(--ae-fs, 1))", color: colors.subtleInk }}>
                Online and Offline counts only. The next day starts from the
                counted figure and carries on from there - days already saved
                after it are recalculated too (what was entered on them is kept;
                only their opening and remaining change). A finished day waits
                for an admin&apos;s approval instead.
              </span>
            </span>
          </label>
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
          title="Review and save counts"
          onClose={() => setShowConfirm(false)}
        >
          <SaveSummary
            page="Manual Count / Audit"
            date={date}
            shift={shift}
            changes={pendingChanges.length}
            products={new Set(pendingChanges.map((c) => c.name)).size}
            notices={[
              ...saveNotices({ date, shift }),
              {
                tone: "info",
                text: "Saved counts are not final until a supervisor publishes them. Saving a count that was already published takes it back to unpublished.",
              },
            ]}
          />
          {pendingChanges.length === 0 ? (
            <p style={{ margin: 0, color: colors.subtleInk, fontSize: "calc(13px * var(--ae-fs, 1))" }}>
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

const openingTagStyle = {
  padding: "1px 7px",
  borderRadius: 999,
  background: "var(--ae-btn-yellow)",
  color: "var(--ae-btn-yellow-text)",
  fontSize: "calc(11px * var(--ae-fs, 1))",
  fontWeight: 700,
  whiteSpace: "nowrap",
} as const;
