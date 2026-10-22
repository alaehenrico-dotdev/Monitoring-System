import { useState } from "react";
import { useNavigate } from "react-router-dom";
import type { EntryLocation } from "../api/ops";
import type { Shift } from "../types";
import { ROW_FILTER_LABELS, type RowFilter } from "../hooks/useGridView";
import { useFinishDay } from "../hooks/useFinishDay";
import { addDaysIso } from "../utils/dateMath";
import { getCurrentShiftAndDate, isWholeDayMode, SHIFTS, SHIFT_SHORT_LABELS } from "../utils/shift";
import { CategoryFilter } from "./CategoryFilter";
import { CopyPreviousButton, type CopyPreviousButtonProps } from "./CopyPreviousButton";
import { DateStepper } from "./DateStepper";
import { FinishThroughDialog } from "./FinishThrough";
import { ClearFilters, FilterSlot } from "./FilterSlot";
import { ClockIcon, CollapseAllIcon, EllipsisIcon, ExpandAllIcon, HistoryIcon, LockCheckIcon, PrinterIcon, ReorderIcon, ReportIcon, SaveIcon, SyncIcon, UndoIcon } from "./icons";
import { MenuBar, type MenuDef, type MenuItemDef, type MenuSection } from "./MenuBar";
import { ReorderProductsDialog } from "./ReorderProductsButton";
import { RowFilterSelect } from "./RowFilterSelect";
import { SaveStatus, type SaveState } from "./SaveStatus";
import { SearchInput } from "./SearchInput";
import { ShiftFilter } from "./ShiftFilter";
import { SplitButton } from "./SplitButton";
import { VersionHistoryPanel } from "./VersionHistoryPanel";
import { ZoomControl } from "./ZoomControl";

const ZOOM_MIN = 50;
const ZOOM_MAX = 200;
const ZOOM_STEP = 25;

const PAGE_LABEL: Record<EntryLocation, string> = { ONLINE: "Online", OFFLINE: "Offline" };
const LOCKED_OUT = "Save or discard your changes first - they would be locked out";

export interface EntryToolbarProps {
  location: EntryLocation;
  /* the sheet */
  date: string;
  shift: Shift;
  onDateChange: (date: string) => void;
  onShiftChange: (shift: Shift) => void;
  /* filters */
  query: string;
  onQueryChange: (query: string) => void;
  categories: string[];
  category: string;
  onCategoryChange: (category: string) => void;
  rowFilter: RowFilter;
  onRowFilterChange: (filter: RowFilter) => void;
  /// Shown on the "Only changed" option.
  changedCount: number;
  /* editing */
  canEdit: boolean;
  saving: boolean;
  /// Products with staged edits - what Save will submit.
  pendingCount: number;
  /// Individual cells with staged edits.
  pendingCellCount: number;
  canUndo: boolean;
  canRedo: boolean;
  onUndo: () => void;
  onRedo: () => void;
  /// Opens the page's own "Discard unsaved changes?" confirmation.
  onDiscard: () => void;
  onRefresh: () => void;
  /// Everything CopyPreviousButton needs, or null on a sheet that cannot be filled.
  copyPrevious: Omit<CopyPreviousButtonProps, "open" | "onOpenChange" | "anchorEl" | "hideTrigger" | "disabled"> | null;
  /* saving */
  /// Opens the page's own "Unsaved changes" review (where Save is confirmed).
  onSave: () => void;
  saveState: SaveState;
  savedAt?: number;
  onRetrySave: () => void;
  /* view */
  /// The grid has loaded.
  hasRows: boolean;
  anyExpanded: boolean;
  onToggleExpandAll: () => void;
  isAdmin: boolean;
  zoom: number;
  onZoomChange: (zoom: number) => void;
  /* export */
  pdfBusy: boolean;
  onPdf: () => void;
  /* finishing */
  dayLock: { loaded: boolean; locked: boolean; blockedBy: { entryDate: string; shift: Shift } | null };
  onFinished: () => void;
  onError: (message: string) => void;
  /// Worth a look before locking (products below zero...). Shown in Finish's confirmation.
  finishWarnings: string[];
}

/**
 * The entry sheet's toolbar, as a menu bar:
 *
 *   [Sheet] [Edit] [View] [Export] | search, filters, date, shift | ...  Save  Finish  Zoom
 *
 * The frequent things stay on the bar (filters, the date, Save, Finish); the rest
 * lives in menus, each action with its shortcut where one is really bound, and
 * every unavailable action still shown with the reason it is unavailable. One
 * component serves Online and Offline Entry, which differ only in `location`.
 *
 * It shrinks in three steps by the width of the bar itself (container queries in
 * index.css, not the window): wide shows everything; medium turns the filters
 * into compact chips; narrow keeps search, the date and Save and moves everything
 * else into the "..." menu, which is built from the same items as the others so
 * nothing is reachable in one layout and missing in another.
 */
export function EntryToolbar(p: EntryToolbarProps) {
  const navigate = useNavigate();
  const [copyOpen, setCopyOpen] = useState(false);
  const [copyAnchor, setCopyAnchor] = useState<HTMLElement | null>(null);
  const [reorderOpen, setReorderOpen] = useState(false);
  const [throughOpen, setThroughOpen] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);

  const unsaved = p.pendingCount > 0;
  const current = getCurrentShiftAndDate();
  const onCurrentSheet = p.date === current.date && p.shift === current.shift;

  const blocked = p.dayLock.loaded && p.dayLock.blockedBy !== null;
  const finishable = p.dayLock.loaded && !p.dayLock.locked && !p.dayLock.blockedBy;
  const finishReason = unsaved ? LOCKED_OUT : undefined;
  const finish = useFinishDay({
    date: p.date,
    shift: p.shift,
    location: p.location,
    disabled: unsaved,
    disabledReason: LOCKED_OUT,
    onFinished: p.onFinished,
    onError: p.onError,
    warnings: p.finishWarnings,
    enabled: finishable,
    canSignOff: p.isAdmin,
  });

  const activeFilters = (p.query.trim() !== "" ? 1 : 0) + (p.category !== "" ? 1 : 0) + (p.rowFilter !== "all" ? 1 : 0);
  const clearFilters = () => {
    p.onQueryChange("");
    p.onCategoryChange("");
    p.onRowFilterChange("all");
  };

  /* ---------------------------------------------------------------- menus */
  const readOnly = !p.canEdit ? "This sheet is read-only right now" : undefined;
  const loading = !p.hasRows ? "The sheet is still loading" : undefined;
  const saveInProgress = p.saving ? "Wait for the save to finish" : undefined;

  const sheetItems: MenuItemDef[] = [
    {
      id: "current-shift",
      label: "Jump to the current shift",
      icon: <ClockIcon />,
      disabledReason: onCurrentSheet ? "Already on the current shift" : undefined,
      onSelect: () => {
        p.onDateChange(current.date);
        p.onShiftChange(current.shift);
      },
    },
    { id: "awaiting", label: "Awaiting release…", onSelect: () => navigate("/awaiting-release") },
    { id: "corrections", label: "Corrections…", onSelect: () => navigate("/corrections") },
  ];

  const editSections: MenuSection[] = [
    {
      items: [
        { id: "undo", label: "Undo", icon: <UndoIcon />, shortcut: "Ctrl+Z", disabledReason: readOnly ?? (p.canUndo ? undefined : "Nothing to undo"), onSelect: p.onUndo },
        { id: "redo", label: "Redo", shortcut: "Ctrl+Shift+Z", disabledReason: readOnly ?? (p.canRedo ? undefined : "Nothing to redo"), onSelect: p.onRedo },
      ],
    },
    {
      items: [
        {
          id: "copy-previous",
          label: "Copy from a previous period…",
          icon: <SyncIcon />,
          disabledReason: readOnly ?? loading ?? (p.copyPrevious ? undefined : "Nothing to copy from"),
          onSelect: (anchor) => {
            setCopyAnchor(anchor);
            setCopyOpen(true);
          },
        },
        {
          id: "discard",
          label: "Discard changes…",
          tone: "danger",
          disabledReason: !unsaved ? "No changes to discard" : saveInProgress,
          onSelect: p.onDiscard,
        },
      ],
    },
    { items: [{ id: "refresh", label: "Refresh", icon: <SyncIcon />, disabledReason: saveInProgress, onSelect: p.onRefresh }] },
  ];

  const viewSections: MenuSection[] = [
    {
      items: [
        {
          id: "expand-all",
          label: p.anyExpanded ? "Collapse all categories" : "Expand all categories",
          icon: p.anyExpanded ? <CollapseAllIcon /> : <ExpandAllIcon />,
          disabledReason: loading,
          onSelect: p.onToggleExpandAll,
        },
        {
          id: "reorder",
          label: "Reorder products…",
          icon: <ReorderIcon />,
          disabledReason: p.isAdmin ? undefined : "Only an admin can change the product order",
          onSelect: () => setReorderOpen(true),
        },
        {
          id: "version-history",
          label: "Version history",
          icon: <HistoryIcon />,
          disabledReason: p.isAdmin ? undefined : "Only an admin can see version history",
          onSelect: () => setHistoryOpen(true),
        },
      ],
    },
    {
      items: [
        { id: "zoom-in", label: "Zoom in", disabledReason: p.zoom >= ZOOM_MAX ? `Already at ${ZOOM_MAX}%` : undefined, onSelect: () => p.onZoomChange(Math.min(ZOOM_MAX, p.zoom + ZOOM_STEP)) },
        { id: "zoom-out", label: "Zoom out", disabledReason: p.zoom <= ZOOM_MIN ? `Already at ${ZOOM_MIN}%` : undefined, onSelect: () => p.onZoomChange(Math.max(ZOOM_MIN, p.zoom - ZOOM_STEP)) },
        { id: "zoom-reset", label: "Reset zoom (100%)", disabledReason: p.zoom === 100 ? "Already at 100%" : undefined, onSelect: () => p.onZoomChange(100) },
      ],
    },
  ];

  const notSaved = (what: string) => (unsaved ? `Save your changes first - ${what} reflects only saved data` : undefined);
  const exportSections: MenuSection[] = [
    {
      items: [
        { id: "print", label: "Print…", icon: <PrinterIcon />, shortcut: "Ctrl+P", disabledReason: loading, onSelect: () => window.print() },
        {
          id: "pdf",
          label: "Download PDF",
          icon: <PrinterIcon />,
          disabledReason: notSaved("the PDF") ?? loading ?? (p.pdfBusy ? "Preparing the PDF…" : undefined),
          onSelect: p.onPdf,
        },
        { id: "report", label: "Daily report…", icon: <ReportIcon />, disabledReason: notSaved("the report"), onSelect: () => navigate(`/daily-report?date=${p.date}&auto=1`) },
      ],
    },
  ];

  const menus: MenuDef[] = [
    { id: "sheet", label: "Sheet", sections: [{ items: sheetItems }] },
    { id: "edit", label: "Edit", sections: editSections },
    { id: "view", label: "View", sections: viewSections },
    { id: "export", label: "Export", sections: exportSections },
  ];

  /* The "..." menu: every menu's items, plus the filters and Finish that the
     narrow bar has no room for. Built from the same items, so it can never
     disagree with the menus about what is available or why not. */
  const flat = (sections: MenuSection[]) => sections.flatMap((s) => s.items);
  const finishItems: MenuItemDef[] = blocked
    ? [{ id: "finish-pending", label: "Finish pending days…", icon: <LockCheckIcon />, disabledReason: finishReason, onSelect: () => setThroughOpen(true) }]
    : finishable
      ? [
          { id: "finish-day", label: "Finish day…", icon: <LockCheckIcon />, disabledReason: finishReason, onSelect: () => void finish.open() },
          { id: "finish-through", label: "Finish through a date…", disabledReason: finishReason, onSelect: () => setThroughOpen(true) },
        ]
      : [];
  const overflowSections: MenuSection[] = [
    { heading: "Sheet", items: sheetItems },
    { heading: "Edit", items: flat(editSections) },
    { heading: "View", items: flat(viewSections) },
    { heading: "Export", items: flat(exportSections) },
    {
      heading: "Category",
      items: ["", ...p.categories].map((c) => ({ id: `cat:${c}`, label: c === "" ? "All categories" : c, checked: p.category === c, onSelect: () => p.onCategoryChange(c) })),
    },
    {
      heading: "Rows",
      items: (["all", "changed", "negative"] as const).map((f) => ({ id: `rows:${f}`, label: ROW_FILTER_LABELS[f], checked: p.rowFilter === f, onSelect: () => p.onRowFilterChange(f) })),
    },
    ...(isWholeDayMode()
      ? []
      : [
          {
            heading: "Shift",
            items: SHIFTS.map((s) => ({ id: `shift:${s}`, label: SHIFT_SHORT_LABELS[s], checked: p.shift === s, onSelect: () => p.onShiftChange(s) })),
          },
        ]),
    ...(activeFilters > 0
      ? [{ items: [{ id: "clear-filters", label: `Clear filters (${activeFilters})`, onSelect: clearFilters }] }]
      : []),
    ...(finishItems.length > 0 ? [{ heading: "Finish", items: finishItems }] : []),
  ];
  const overflow: MenuDef = { id: "more", label: "More actions", icon: <EllipsisIcon />, sections: overflowSections };

  /* ----------------------------------------------------------------- Save */
  const saveReason = !p.canEdit ? "This sheet is read-only right now" : !unsaved ? "No changes to save" : p.saving ? "Saving…" : undefined;

  return (
    <div className="ae-toolbar ae-mb no-print">
      <div className="ae-mb-menus">
        <MenuBar label={`${PAGE_LABEL[p.location]} sheet menus`} menus={menus} />
      </div>
      <span className="ae-mb-divider" aria-hidden />

      <div className="ae-mb-filters">
        <FilterSlot active={p.query.trim() !== ""} label="Search">
          <SearchInput value={p.query} onChange={p.onQueryChange} placeholder="Search SKU or category…" />
        </FilterSlot>
        <span className="ae-mb-optional">
          <FilterSlot active={p.category !== ""} label="Category">
            <CategoryFilter categories={p.categories} value={p.category} onChange={p.onCategoryChange} labelPrefix="Category" />
          </FilterSlot>
          <FilterSlot active={p.rowFilter !== "all"} label="Rows">
            <RowFilterSelect value={p.rowFilter} onChange={p.onRowFilterChange} changedCount={p.changedCount} labelPrefix="Rows" />
          </FilterSlot>
        </span>
        <DateStepper value={p.date} onChange={p.onDateChange} todayValue={current.date} />
        <span className="ae-mb-optional">
          <ShiftFilter value={p.shift} onChange={(s) => s && p.onShiftChange(s)} labelPrefix="Shift" />
          <ClearFilters count={activeFilters} onClear={clearFilters} />
        </span>
      </div>

      <div className="ae-mb-spacer" />

      <div className="ae-mb-actions">
        {p.canEdit && p.pendingCellCount > 0 && (
          <span className="ae-unsaved-badge ae-mb-optional" aria-live="polite">
            {p.pendingCellCount} unsaved change{p.pendingCellCount === 1 ? "" : "s"}
          </span>
        )}
        <SaveStatus state={p.saveState} savedAt={p.savedAt} onRetry={p.onRetrySave} />
        {p.canEdit && (
          <button
            type="button"
            className="ae-mb-btn ae-mb-btn--primary"
            aria-disabled={saveReason ? true : undefined}
            aria-describedby={saveReason ? "ae-mb-save-reason" : undefined}
            title={saveReason ?? "Review and save changes (Ctrl+S)"}
            aria-keyshortcuts="Control+S"
            onClick={() => !saveReason && p.onSave()}
          >
            <SaveIcon />
            <span>Save{unsaved ? ` (${p.pendingCount})` : ""}</span>
          </button>
        )}
        {saveReason && (
          <span id="ae-mb-save-reason" hidden>
            {saveReason}
          </span>
        )}

        <span className="ae-mb-finish">
          {finishable && (
            <SplitButton
              label="Finish day"
              icon={<LockCheckIcon />}
              tone="warn"
              attention={finish.ready}
              disabledReason={finishReason}
              title={finish.ready ? `Every product is saved - lock the ${PAGE_LABEL[p.location]} page` : `Lock the ${PAGE_LABEL[p.location]} page`}
              onClick={() => void finish.open()}
              menuLabel="Finish options"
              items={[{ id: "through", label: "Finish through a date…", disabledReason: finishReason, onSelect: () => setThroughOpen(true) }]}
            />
          )}
          {blocked && (
            <SplitButton
              label="Finish pending days"
              icon={<LockCheckIcon />}
              tone="warn"
              disabledReason={finishReason}
              title="Earlier days are still unfinished: finish them up to a date, oldest first"
              onClick={() => setThroughOpen(true)}
              menuLabel="Finish options"
              items={[]}
            />
          )}
        </span>

        <span className="ae-mb-zoom">
          <ZoomControl zoom={p.zoom} onChange={p.onZoomChange} />
        </span>
        <span className="ae-mb-overflow">
          <MenuBar label="More actions" menus={[overflow]} />
        </span>
      </div>

      {finish.dialogs}
      {throughOpen && (
        <FinishThroughDialog
          defaultDate={blocked ? addDaysIso(p.date, -1) : p.date}
          location={p.location}
          onClose={() => setThroughOpen(false)}
          onFinished={p.onFinished}
          onError={p.onError}
        />
      )}
      {reorderOpen && p.isAdmin && <ReorderProductsDialog onClose={() => setReorderOpen(false)} />}
      {historyOpen && p.isAdmin && (
        <VersionHistoryPanel sheet={p.location === "ONLINE" ? "online" : "offline"} date={p.date} shift={p.shift} onClose={() => setHistoryOpen(false)} />
      )}
      {p.copyPrevious && (
        <CopyPreviousButton {...p.copyPrevious} disabled={!p.canEdit} hideTrigger open={copyOpen} onOpenChange={setCopyOpen} anchorEl={copyAnchor} />
      )}
    </div>
  );
}
