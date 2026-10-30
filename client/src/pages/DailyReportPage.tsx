import { useBusyAction } from "../hooks/useBusyAction";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { getDailyReport, type AuditReportRow, type DailyReport } from "../api/reports";
import { getDayExtraNames, type DayExtraNames } from "../api/extraLabels";
import { getDailyOut, type DailyOutEntry } from "../api/dailyOut";
import { saveDailyReportToDrive } from "../api/drive";
import { notify } from "../utils/notify";
import { ConfirmDialog } from "../components/ConfirmDialog";
import { Dropdown } from "../components/Dropdown";
import { StockGrid, type GridRow } from "../components/StockGrid";
import { TotalStocksTable } from "../components/TotalStocksTable";
import { PageToolbar } from "../components/PageToolbar";
import { FilterSlot } from "../components/FilterSlot";
import { DateStepper } from "../components/DateStepper";
import { PageHeader } from "../components/PageHeader";
import { useZoom, zoomStyle, ZoomControl } from "../components/ZoomControl";
import { CollapseAllIcon, ExpandAllIcon, SyncIcon } from "../components/icons";
import { zoomSection } from "../utils/zoomMenu";
import { fitWidthItem } from "../utils/fitWidthMenu";
import { useFitWidth } from "../hooks/useFitWidth";
import { useHideEmpty } from "../hooks/useHideEmpty";
import { describeHiddenOnPage, viewStockSheet, viewTotalRows } from "../utils/hideEmptyReport";
import { Toast } from "../components/Toast";
import { InlineLoading } from "../components/Spinner";
import { CategoryFilter } from "../components/CategoryFilter";
import {
  columnsWithExtras,
  extraColumnsFromRows,
} from "../hooks/useExtraColumns";
import {
  onlineStockColumns,
  offlineStockColumns,
} from "../config/stockColumns";
import { toExcelTable, downloadExcel } from "../utils/excel";
import { formatDateDisplay } from "../utils/dateFormat";
import { downloadTablePdf } from "../utils/tablePdf";
import {
  filterNotes,
  flatSection,
  formatCount,
  pdfFileName,
  stockGridSection,
  totalStocksSection,
  type PdfSection,
} from "../utils/pdfTables";
import { colors } from "../theme";
import { useRealtimeVersion } from "../context/RealtimeContext";
import { Link, useSearchParams } from "react-router-dom";
import { recordReportHistory } from "../api/reportHistory";
import {
  DownloadIcon,
  HistoryIcon,
  LockIcon,
  PlayIcon,
  PrinterIcon,
} from "../components/icons";
import { AlertDialog, UnsavedWorkDialog } from "../components/AlertDialog";
import { findUnsavedWork, type UnsavedWorkItem } from "../utils/unsavedWork";
import { useTopProgress } from "../hooks/useTopProgress";
import { useAuth } from "../context/AuthContext";
import { getCurrentShiftAndDate } from "../utils/shift";

// The business date the entry pages are working on right now (local time, and
// a Night shift after midnight still belongs to the previous day). The old
// `new Date().toISOString()` was the UTC date, which can be a different day
// from the one the entries were saved under - so a report generated for
// "today" looked empty even though the entries existed.
function today(): string {
  return getCurrentShiftAndDate().date;
}

type ReportSection = "all" | "online" | "offline" | "total" | "out" | "audit";

const SECTION_LABELS: Record<ReportSection, string> = {
  all: "Full Report (Online + Offline + Consolidated + Daily Out + Audit)",
  online: "Online Only",
  offline: "Offline Only",
  total: "Consolidated Only",
  out: "Daily Out Only",
  audit: "Audit Only",
};

// Not every row the report returns is real data: a date nobody has entered
// anything for still comes back as one row per product, flagged isSaved:
// false. If the flag is ever missing, fall back to "any non-zero stock
// figure" rather than treating the row as empty - a report should never be
// blocked just because a flag went missing.
const NON_STOCK_KEYS = new Set(["productId", "entryDate", "shift"]);
function rowHasSavedData(row: { isSaved?: boolean; entry: object }): boolean {
  if (typeof row.isSaved === "boolean") return row.isSaved;
  return Object.entries(row.entry).some(
    ([k, v]) =>
      !NON_STOCK_KEYS.has(k) && Number(v) !== 0 && !Number.isNaN(Number(v)),
  );
}

/// Whether there's actually a report to show for this date: at least one
/// saved Online/Offline entry, or a saved manual count (which the Total
/// section reports on its own).
function reportHasData(report: DailyReport): boolean {
  return (
    report.online.some(rowHasSavedData) ||
    report.offline.some(rowHasSavedData) ||
    report.total.some(
      (r) => r.totalManualCount !== null && r.totalManualCount !== undefined,
    )
  );
}

// StockGrid requires an onCommit handler, but read-only mode never calls it
// (editable cells render as plain text, not inputs, when readOnly is set).
async function noop() {}

/**
 * Section 4.8 - a printable/exportable view of a given date's Online,
 * Offline, and Total grids, laid out the same way as the current Excel
 * printout (Section 8.1: generated from the database instead of by hand).
 *
 * Previously built its own ad-hoc table that derived columns from
 * `Object.keys(rows[0])`: saved rows (full Prisma records) and not-yet-saved
 * preview rows have different fields, so mixing them made columns
 * inconsistent between sections and, for any row missing a key the first
 * row happened to have, rendered the literal text "undefined" into the
 * cell. Reusing StockGrid/TotalStocksTable - the same components the live
 * entry pages already use correctly - fixes all of that at once and gets
 * category grouping/subtotals and proper number formatting for free.
 */
export function DailyReportPage() {
  const progress = useTopProgress();
  const [searchParams] = useSearchParams();
  const [date, setDate] = useState(searchParams.get("date") ?? today());
  const [report, setReport] = useState<DailyReport | null>(null);
  // The shown date's Daily Out figures (stock that left the company). Fetched
  // beside the report; a failure leaves it null and the section says so rather
  // than blocking the rest of the report.
  const [dailyOut, setDailyOut] = useState<DailyOutEntry | null>(null);
  const [error, setError] = useState<string | null>(null);
  // The date whose report is being saved to Google Drive right now (null = none).
  const [driveSaving, setDriveSaving] = useState<string | null>(null);
  // Names typed into added-column headers on the shown date's sheets.
  const [extraNames, setExtraNames] = useState<DayExtraNames>({
    ONLINE: {},
    OFFLINE: {},
  });
  // Which part of the report to show/export - defaults to the full,
  // three-section report (previous behavior). Picking a single section
  // filters both the on-screen view (so Print/PDF reflects just that
  // section) and Export CSV, instead of always forcing a combined
  // multi-section file when someone only wants e.g. the Online numbers.
  const [reportSection, setReportSection] = useState<ReportSection>("all");
  // Narrows every section (and the CSV/PDF that come from them) to one
  // category at a time - the same exact-match filter CategoryFilter already
  // provides on the entry pages, so a report can be scoped to e.g. just
  // "Class A (Liter)" instead of always covering every category at once.
  const [categoryFilter, setCategoryFilter] = useState("");
  // Bumped on every successful load - used to key the report's grids (below)
  // so each Generate remounts them fresh, with every category starting
  // expanded again, even when re-generating the same date.
  const [reportVersion, setReportVersion] = useState(0);
  const printAfterLoad = useRef(searchParams.get("history") === "1");
  const realtimeVersion = useRealtimeVersion();
  const [zoom, setZoom] = useZoom("daily-report");
  const [fit, setFit] = useFitWidth("daily-report");
  // View > Hide empty rows / columns. Off by default; kept in this browser.
  const hideEmpty = useHideEmpty("daily-report");
  // View > Expand/Collapse all categories: one command for every table on the
  // page; each table reports whether any of its categories is open.
  const [catCommand, setCatCommand] = useState<{ expanded: boolean; id: number } | null>(null);
  const [expandedBySection, setExpandedBySection] = useState({ online: false, offline: false, total: false });
  const anyExpanded = Object.values(expandedBySection).some(Boolean);
  const onOnlineExpanded = useCallback((v: boolean) => setExpandedBySection((p) => ({ ...p, online: v })), []);
  const onOfflineExpanded = useCallback((v: boolean) => setExpandedBySection((p) => ({ ...p, offline: v })), []);
  const onTotalExpanded = useCallback((v: boolean) => setExpandedBySection((p) => ({ ...p, total: v })), []);
  const { user } = useAuth();
  const [generating, setGenerating] = useState(false);
  // Generate asks first: it also saves the date's report to Google Drive.
  const [confirmGenerate, setConfirmGenerate] = useState(false);
  // Only the newest request may update the page - a slow earlier response
  // (older date, or a realtime refresh) must never overwrite a newer report.
  const requestId = useRef(0);
  // Alert dialogs shown instead of generating: unsaved entry/count edits for
  // this date, or a date with nothing saved to report on.
  const [unsavedWork, setUnsavedWork] = useState<UnsavedWorkItem[] | null>(
    null,
  );
  const [emptyMessage, setEmptyMessage] = useState<string | null>(null);
  function changeDate(nextDate: string) {
    if (nextDate === date) return;
    // Invalidate in-flight loads and remove the old snapshot immediately so
    // the heading and any exports can never refer to a different date.
    requestId.current++;
    setGenerating(false);
    setReport(null);
    setDailyOut(null);
    setError(null);
    setEmptyMessage(null);
    setDate(nextDate);
  }
  useEffect(() => {
    if (searchParams.get("history") === "1" || searchParams.get("auto") === "1")
      load();
    // History links and the entry pages' Report button intentionally
    // generate the selected report once on open.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Keep an already-generated report live - re-runs the same Generate this
  // page's own toolbar button would, but only while a report is already on
  // screen, so realtime updates never auto-run a report nobody asked for.
  useEffect(() => {
    if (report) load({ silent: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [realtimeVersion]);

  // Opened from the report history: build the PDF as soon as the report has
  // loaded (there's no DOM to wait for - the PDF is built from the data).
  useEffect(() => {
    if (!report || !printAfterLoad.current) return;
    printAfterLoad.current = false;
    void handlePdf();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [report]);

  // `silent` is the realtime refresh of a report that's already on screen: it
  // quietly swaps in the fresh numbers, and never pops a dialog, clears the
  // report or shows an error just because someone else is mid-edit.
  /// `notify` is for a refresh the person asked for (View > Refresh): it keeps
  /// the report and its collapsed categories like a silent one, but still says so
  /// when it cannot run (unsaved edits) or fails, rather than doing nothing.
  /// Saves the generated date to Drive and tells the person how it went: new or
  /// changed file, already up to date, or the reason it failed. Not connected is
  /// silent - the report still generated, there is just no Drive to save it to.
  async function saveToDriveAndTell(day: string) {
    // A live "saving" toast, but only if the save is not instant (so a person
    // without Drive connected never sees it flash).
    const showTimer = window.setTimeout(() => setDriveSaving(day), 400);
    try {
      const { status } = await saveDailyReportToDrive(day);
      window.clearTimeout(showTimer);
      setDriveSaving(null);
      if (status === "saved") notify({ level: "success", message: `Daily Report for ${day} saved to Google Drive.` });
      else if (status === "unchanged") notify({ level: "info", message: `Daily Report for ${day} is already up to date in Google Drive.` });
    } catch (e) {
      window.clearTimeout(showTimer);
      setDriveSaving(null);
      notify({ level: "error", message: `Could not save the ${day} Daily Report to Google Drive: ${e instanceof Error ? e.message : "unknown error"}` });
    }
  }

  /// `saveToDrive` is only for a confirmed Generate: it saves the date's report to
  /// Google Drive once the report has actually loaded. Reopening from history, the
  /// live refresh and View > Refresh never upload.
  function load({ silent = false, notify: notifyFailure = false, saveToDrive = false }: { silent?: boolean; notify?: boolean; saveToDrive?: boolean } = {}) {
    if (!silent) setError(null);

    // A report only reads saved data - staged edits for this date would be
    // silently left out of it.
    const unsaved = findUnsavedWork({ from: date, to: date });
    if (unsaved.length > 0) {
      if (!silent || notifyFailure) setUnsavedWork(unsaved);
      return;
    }

    const id = ++requestId.current;
    const requestedDate = date;
    if (!silent) setGenerating(true);
    getDailyReport(requestedDate)
      .then((nextReport) => {
        if (id !== requestId.current) return;
        if (nextReport.date !== requestedDate) {
          if (!silent) {
            setReport(null);
            setError(
              "The server returned a report for a different date. Please generate it again.",
            );
          }
          return;
        }
        if (!reportHasData(nextReport)) {
          if (silent) return;
          // Clear any report still on screen from a different date, so it
          // isn't left sitting next to a date picker that now says otherwise.
          setReport(null);
          setEmptyMessage(
            `No saved data for ${formatDateDisplay(date)}. Entries are filed under the shift's own date - a Night shift after midnight belongs to the previous day.`,
          );
          return;
        }
        setReport(nextReport);
        if (saveToDrive) void saveToDriveAndTell(requestedDate);
        void getDayExtraNames(requestedDate).then((names) => {
          if (id === requestId.current) setExtraNames(names);
        });
        void getDailyOut(requestedDate, requestedDate)
          .then((rows) => {
            if (id === requestId.current) setDailyOut(rows[0] ?? null);
          })
          .catch(() => {
            if (id === requestId.current) setDailyOut(null);
          });
        // Only a fresh Generate remounts the grids (every category expanded
        // again); a silent refresh keeps whatever the person had collapsed.
        if (!silent) setReportVersion((v) => v + 1);
      })
      .catch((e) => {
        if (id !== requestId.current || (silent && !notifyFailure)) return;
        setError(e instanceof Error ? e.message : "Failed to build report");
      })
      .finally(() => {
        if (id === requestId.current) setGenerating(false);
      });
  }

  // Every category across all three sections (not just whichever section is
  // currently selected) - so switching the section dropdown doesn't also
  // reset an already-picked category filter to "no such option".
  const categories = report
    ? Array.from(
        new Set(
          [...report.online, ...report.offline, ...report.total].map(
            (r) => r.product.category,
          ),
        ),
      ).sort()
    : [];

  // Columns an encoder added to the live grids and saved individually come
  // back flattened onto these rows (server: utils/stockExtras.ts), so the
  // report can show the breakdown beside each total it adds up to. A date
  // with none of them leaves every column list - and so every table, PDF and
  // export - exactly as it was.
  const onlineExtras = useMemo(
    () =>
      extraColumnsFromRows(
        report?.online as unknown as GridRow[] | null,
        onlineStockColumns,
      ),
    [report],
  );
  const offlineExtras = useMemo(
    () =>
      extraColumnsFromRows(
        report?.offline as unknown as GridRow[] | null,
        offlineStockColumns,
      ),
    [report],
  );
  // One trimmed view of each table (rows and columns with nothing in them left
  // out when View > Hide empty ... is on, and the Category filter applied) that
  // the screen, the PDF and Excel all read, so they always agree.
  type ViewRow = { product: { category: string }; entry: Record<string, unknown> };
  const onlineView = useMemo(
    () =>
      viewStockSheet(
        (report?.online ?? []) as unknown as ViewRow[],
        onlineStockColumns,
        onlineExtras,
        { rows: hideEmpty.rows, columns: hideEmpty.columns },
        categoryFilter,
      ),
    [report, onlineExtras, hideEmpty.rows, hideEmpty.columns, categoryFilter],
  );
  const offlineView = useMemo(
    () =>
      viewStockSheet(
        (report?.offline ?? []) as unknown as ViewRow[],
        offlineStockColumns,
        offlineExtras,
        { rows: hideEmpty.rows, columns: hideEmpty.columns },
        categoryFilter,
      ),
    [report, offlineExtras, hideEmpty.rows, hideEmpty.columns, categoryFilter],
  );
  const totalView = useMemo(
    () => viewTotalRows(report?.total ?? [], { rows: hideEmpty.rows, columns: hideEmpty.columns }, categoryFilter),
    [report, hideEmpty.rows, hideEmpty.columns, categoryFilter],
  );
  const hiddenNote = describeHiddenOnPage({
    rows: onlineView.hiddenRows + offlineView.hiddenRows + totalView.hiddenRows,
    columns: onlineView.hiddenColumns + offlineView.hiddenColumns,
  });
  const onlineColumns = useMemo(
    () => columnsWithExtras(onlineView.columns, onlineView.extras, extraNames.ONLINE),
    [onlineView, extraNames],
  );
  const offlineColumns = useMemo(
    () => columnsWithExtras(offlineView.columns, offlineView.extras, extraNames.OFFLINE),
    [offlineView, extraNames],
  );

  // Report History records a report when it has actually been saved - the PDF
  // written or the Excel file handed over - not when it merely appeared on
  // screen. Skipped when the page was opened from the history itself (the
  // entry already exists). Best effort: a failed history write never surfaces
  // as an export failure (see api/reportHistory.ts).
  function logExported() {
    if (!report || searchParams.get("history") === "1") return;
    recordReportHistory({
      type: "Daily Report",
      scope: report.date,
      route: `/daily-report?history=1&date=${report.date}`,
      section:
        reportSection === "online" || reportSection === "offline"
          ? reportSection
          : "all",
    }).catch(() => {});
  }

  async function handleExport() {
    if (!report) return;
    const online = section(
      "ONLINE STOCK MONITORING",
      report.date,
      onlineView.rows as unknown as CsvSectionRow[],
      onlineColumns,
    );
    const offline = section(
      "OFFLINE STOCK MONITORING",
      report.date,
      offlineView.rows as unknown as CsvSectionRow[],
      offlineColumns,
    );
    const total = totalSection(report.date, totalView.rows);
    const out = dailyOutExcel(report.date, dailyOut);
    const audit = auditExcel(report.date, report.audit ?? []);

    // "Full Report" still combines every section into one file (previous,
    // only behavior) - a Daily Report is meaningless split across three
    // separate downloads that then have to be reassembled by hand. Excel
    // opens several <table>s in one HTML file as one continuous sheet, so
    // this is just as much "one file" as the old concatenated-CSV version
    // was. Picking a single section instead exports just that table, for
    // when only e.g. the Online numbers are needed rather than the whole
    // thing.
    if (reportSection === "all") {
      const allName = `daily-report-${report.date}.xls`;
      downloadExcel(allName, [online, offline, total, out, audit].join(""), { driveCopy: false });
      logExported();
      return;
    }
    const bySection: Record<Exclude<ReportSection, "all">, string> = {
      online,
      offline,
      total,
      out,
      audit,
    };
    const sectionName = `daily-report-${reportSection}-${report.date}.xls`;
    downloadExcel(sectionName, bySection[reportSection], { driveCopy: false });
    logExported();
  }

  // One PDF for whichever section(s) are selected, with the category filter
  // applied - the same rows Export Excel uses, laid out by utils/tablePdf.ts
  // (fixed page format, columns fitted to the page) instead of window.print().
  const pdfAction = useBusyAction();

  async function handlePdf() {
    if (!report) return;
    const sections: PdfSection[] = [];
    if (reportSection === "all" || reportSection === "online") {
      sections.push(
        stockGridSection(
          onlineView.rows as unknown as GridRow[],
          onlineColumns,
          { title: `ONLINE STOCK MONITORING - ${report.date}` },
        ),
      );
    }
    if (reportSection === "all" || reportSection === "offline") {
      sections.push(
        stockGridSection(
          offlineView.rows as unknown as GridRow[],
          offlineColumns,
          { title: `OFFLINE STOCK MONITORING - ${report.date}` },
        ),
      );
    }
    if (reportSection === "all" || reportSection === "total") {
      sections.push(
        totalStocksSection(totalView.rows, {
          title: `CONSOLIDATED STOCKS - ${report.date}`,
        }),
      );
    }
    if (reportSection === "all" || reportSection === "out") {
      sections.push(
        flatSection(
          DAILY_OUT_COLUMNS.map((header) => ({ header, align: "right" as const })),
          dailyOut ? [dailyOutCells(dailyOut).map(formatCount)] : [],
          {
            title: `DAILY OUT - ${report.date}`,
            emptyMessage: "No Daily Out figures for this date.",
          },
        ),
      );
    }
    if (reportSection === "all" || reportSection === "audit") {
      sections.push(
        flatSection(
          AUDIT_COLUMNS.map((header, i) => ({ header, align: i >= 5 && i <= 7 ? ("right" as const) : ("left" as const) })),
          (report.audit ?? []).map((a) => auditCells(a).map((v) => (typeof v === "number" ? formatCount(v) : v))),
          { title: `AUDIT - ${report.date}`, emptyMessage: "No audit counts were saved for this date." },
        ),
      );
    }
    const pdfName = pdfFileName(
      "daily-report",
      reportSection === "all" ? undefined : reportSection,
      report.date,
    );
    try {
      await progress.track(() =>
        downloadTablePdf({
          filename: pdfName,
          title: "Daily Report",
          subtitle: formatDateDisplay(report.date),
          notes: [
            ...(reportSection === "all" ? [] : [SECTION_LABELS[reportSection]]),
            ...filterNotes({ category: categoryFilter }),
          ],
          sections,
          // The report's own place in Google Drive is the Reports folder.
          driveCopy: false,
        }),
      );
      logExported();
    } catch (e) {
      setError(e instanceof Error ? `PDF failed: ${e.message}` : "PDF failed");
    }
  }

  return (
    <div>
      <PageHeader
        title={`Daily Report - ${formatDateDisplay(date)}`}
        subtitle="Every entry, the audit and Daily Out for any date - saved to Google Drive when generated."
      >
        <PageToolbar
          activeFilters={categoryFilter !== "" ? 1 : 0}
          onClearFilters={() => {
            setCategoryFilter("");
          }}
          label="Daily report"
          menus={[
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
                      disabledReason: report ? undefined : "Generate the report first",
                      onSelect: () => setCatCommand({ expanded: !anyExpanded, id: Date.now() }),
                    },
                    fitWidthItem(fit, setFit),
                    {
                      id: "hide-empty-rows",
                      label: "Hide products with no figures",
                      checked: hideEmpty.rows,
                      onSelect: hideEmpty.toggleRows,
                    },
                    {
                      id: "hide-empty-columns",
                      label: "Hide empty columns",
                      checked: hideEmpty.columns,
                      onSelect: hideEmpty.toggleColumns,
                    },
                    {
                      id: "refresh",
                      label: "Refresh",
                      icon: <SyncIcon />,
                      disabledReason: report ? undefined : "Generate the report first",
                      onSelect: () => load({ silent: true, notify: true }),
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
                      id: "excel",
                      label: "Export Excel",
                      icon: <DownloadIcon />,
                      disabledReason: report ? undefined : "Generate the report first",
                      onSelect: handleExport,
                    },
                    {
                      id: "pdf",
                      label: "Download PDF",
                      icon: <PrinterIcon />,
                      disabledReason: !report
                        ? "Generate the report first"
                        : pdfAction.busy
                          ? "Preparing the PDF…"
                          : undefined,
                      onSelect: () => void pdfAction.run(handlePdf),
                    },
                  ],
                },
              ],
            },
          ]}
          filters={
            <>
              {report && (
                <FilterSlot active={categoryFilter !== ""} label="Category">
                  <CategoryFilter
                    categories={categories}
                    value={categoryFilter}
                    onChange={setCategoryFilter}
                  />
                </FilterSlot>
              )}
              <Dropdown
                aria-label="Report section"
                value={reportSection}
                onChange={(v) => setReportSection(v as ReportSection)}
                title="Which section to view/export"
                options={(Object.keys(SECTION_LABELS) as ReportSection[]).map(
                  (s) => ({ value: s, label: SECTION_LABELS[s] }),
                )}
              />
              <DateStepper
                value={date}
                onChange={changeDate}
                todayValue={getCurrentShiftAndDate().date}
              />
            </>
          }
          actions={
            user?.role === "SUPERVISOR_ADMIN" && (
              <Link
                to="/daily-report-history"
                className="ae-mb-btn"
                style={{ textDecoration: "none" }}
              >
                <HistoryIcon /> <span>Daily History</span>
              </Link>
            )
          }
          primary={
            <button
              type="button"
              className="ae-mb-btn ae-mb-btn--primary"
              aria-disabled={generating || undefined}
              title={generating ? "Generating…" : "Generate the report for this date and save it to Google Drive"}
              onClick={() => !generating && setConfirmGenerate(true)}
            >
              <PlayIcon /> <span>{generating ? "Generating…" : "Generate"}</span>
            </button>
          }
          trailing={<ZoomControl zoom={zoom} onChange={setZoom} />}
        />
      </PageHeader>

      <Toast
        message={error}
        onDismiss={() => setError(null)}
        variant="error"
        duration={null}
      />
      <Toast
        id="drive-report-saving"
        message={driveSaving ? <InlineLoading size="sm" label={`Saving the ${driveSaving} Daily Report to Google Drive…`} /> : null}
        onDismiss={() => setDriveSaving(null)}
        variant="info"
        duration={null}
        // The spinner in the message is the indicator; the "i" badge would be a second icon.
        hideIcon
      />

      {report?.snapshot && (
        <div className="ae-day-lock" role="status">
          <span className="ae-day-lock-icon" aria-hidden>
            <LockIcon />
          </span>
          <div className="ae-day-lock-text">
            <strong>Saved report for {formatDateDisplay(report.date)}</strong>
            <span>
              Frozen when the day was finished (
              {new Date(report.snapshot.savedAt).toLocaleString()}
              {report.snapshot.savedBy ? ` by ${report.snapshot.savedBy.name}` : ""}
              ). Later changes to products, counts or other days don&apos;t
              affect it.
            </span>
          </div>
        </div>
      )}

      {report && hiddenNote && (
        <p role="status" style={{ margin: "0 0 12px", fontSize: "calc(12.5px * var(--ae-fs, 1))", color: colors.subtleInk }}>
          {hiddenNote} Turn it off in View to see everything.
        </p>
      )}

      {report && (
        <div style={zoomStyle(zoom)}>
          {(reportSection === "all" || reportSection === "online") && (
            <>
              <h3 style={{ marginBottom: 8 }}>Online — {report.date}</h3>
              <div style={{ marginBottom: 32 }}>
                <StockGrid
                  key={`online-${reportVersion}`}
                  rows={onlineView.rows as unknown as GridRow[]}
                  columns={onlineView.columns}
                  extraColumns={onlineView.extras}
                  extraNames={extraNames.ONLINE}
                  onCommit={noop}
                  expandAllCommand={catCommand}
                  onAnyExpandedChange={onOnlineExpanded}
                  readOnly
                />
              </div>
            </>
          )}

          {(reportSection === "all" || reportSection === "offline") && (
            <>
              <h3 style={{ marginBottom: 8 }}>Offline — {report.date}</h3>
              <div style={{ marginBottom: 32 }}>
                <StockGrid
                  key={`offline-${reportVersion}`}
                  rows={offlineView.rows as unknown as GridRow[]}
                  columns={offlineView.columns}
                  extraColumns={offlineView.extras}
                  extraNames={extraNames.OFFLINE}
                  onCommit={noop}
                  expandAllCommand={catCommand}
                  onAnyExpandedChange={onOfflineExpanded}
                  readOnly
                />
              </div>
            </>
          )}

          {(reportSection === "all" || reportSection === "total") && (
            <>
              <h3 style={{ marginBottom: 8 }}>Consolidated — {report.date}</h3>
              <TotalStocksTable
                key={`total-${reportVersion}`}
                rows={totalView.rows}
                expandAllCommand={catCommand}
                onAnyExpandedChange={onTotalExpanded}
                fit={fit}
              />
            </>
          )}

          {(reportSection === "all" || reportSection === "out") && (
            <>
              <h3 style={{ marginBottom: 8, marginTop: reportSection === "all" ? 32 : 0 }}>
                Daily Out — {report.date}
              </h3>
              {dailyOut ? (
                <div className="ae-table-scroll" style={{ maxWidth: 560 }}>
                  <table className="ae-table ae-table--center-head ae-table--compact">
                    <thead>
                      <tr>
                        {DAILY_OUT_COLUMNS.map((h) => (
                          <th key={h}>{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      <tr>
                        {dailyOutCells(dailyOut).map((v, i) => (
                          <td key={DAILY_OUT_COLUMNS[i]}>{formatCount(v)}</td>
                        ))}
                      </tr>
                    </tbody>
                  </table>
                </div>
              ) : (
                <p style={{ fontSize: "calc(13px * var(--ae-fs, 1))", color: colors.subtleInk }}>
                  No Daily Out figures for this date.
                </p>
              )}
            </>
          )}

          {(reportSection === "all" || reportSection === "audit") && (
            <>
              <h3 style={{ marginBottom: 8, marginTop: reportSection === "all" ? 32 : 0 }}>Audit — {report.date}</h3>
              {(report.audit ?? []).length > 0 ? (
                <div className="ae-table-scroll">
                  <table className="ae-table ae-table--center-head ae-table--compact">
                    <thead>
                      <tr>
                        {AUDIT_COLUMNS.map((h) => (
                          <th key={h}>{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {(report.audit ?? []).map((a, i) => (
                        <tr key={`${a.product.name}-${a.shift}-${a.location}-${i}`}>
                          {auditCells(a).map((v, c) => (
                            <td key={AUDIT_COLUMNS[c]} style={c <= 2 || c === 8 ? { textAlign: "left" } : undefined}>
                              {typeof v === "number" ? formatCount(v) : v}
                            </td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <p style={{ fontSize: "calc(13px * var(--ae-fs, 1))", color: colors.subtleInk }}>No audit counts were saved for this date.</p>
              )}
            </>
          )}
        </div>
      )}

      {!report && (
        <p style={{ fontSize: "calc(13px * var(--ae-fs, 1))", color: colors.subtleInk }}>
          Pick a date and click Generate to build the report.
        </p>
      )}

      {confirmGenerate && (
        <ConfirmDialog
          title="Generate Daily Report"
          confirmLabel="Generate"
          onCancel={() => setConfirmGenerate(false)}
          onConfirm={() => {
            setConfirmGenerate(false);
            load({ saveToDrive: true });
          }}
        >
          Generate the Daily Report for <strong>{formatDateDisplay(date)}</strong>? It covers every entry and the audit
          for that date, and is saved to Google Drive as one file for the date. Generating the same date again replaces
          that file, or leaves it alone if nothing has changed.
        </ConfirmDialog>
      )}
      {unsavedWork && (
        <UnsavedWorkDialog
          items={unsavedWork}
          onClose={() => setUnsavedWork(null)}
        />
      )}
      {emptyMessage && (
        <AlertDialog
          title="No report to generate"
          onClose={() => setEmptyMessage(null)}
        >
          {emptyMessage}
        </AlertDialog>
      )}
    </div>
  );
}

const DAILY_OUT_COLUMNS = ["Online Out", "Offline Out", "Combined Out"];

function dailyOutCells(e: DailyOutEntry): (number | null)[] {
  return [e.onlineOut, e.offlineOut, e.totalOut];
}

function dailyOutExcel(date: string, e: DailyOutEntry | null): string {
  return toExcelTable(
    DAILY_OUT_COLUMNS,
    e ? [dailyOutCells(e).map((v) => v ?? "")] : [],
    `DAILY OUT - ${date}`,
  );
}

interface CsvSectionRow {
  product: { category: string; sku: string | null; name: string };
  entry: Record<string, unknown>;
}

function section(
  title: string,
  date: string,
  rows: CsvSectionRow[],
  columns: { key: string; label: string }[],
): string {
  const headers = [
    "Category",
    "SKU",
    "Product",
    ...columns.map((c) => c.label),
  ];
  const excelRows = rows.map((r) => [
    r.product.category,
    r.product.sku ?? "",
    r.product.name,
    ...columns.map((c) => String(r.entry[c.key] ?? 0)),
  ]);
  return toExcelTable(headers, excelRows, `${title} - ${date}`);
}

function totalSection(date: string, rows: DailyReport["total"]): string {
  const headers = [
    "Category",
    "SKU",
    "Product",
    "Online Remaining",
    "Offline Remaining",
    "Consolidated Remaining",
    "Manual Count",
    "Variance",
  ];
  const excelRows = rows.map((r) => [
    r.product.category,
    r.product.sku ?? "",
    r.product.name,
    r.onlineRemainingStock,
    r.offlineRemainingStock,
    r.totalRemainingStock,
    r.totalManualCount ?? "",
    r.totalVariance ?? "",
  ]);
  return toExcelTable(headers, excelRows, `CONSOLIDATED STOCKS - ${date}`);
}

const AUDIT_COLUMNS = ["Category", "SKU", "Product", "Shift", "Location", "System Remaining", "Counted", "Variance", "Remarks", "Status"];

const SHIFT_NAME: Record<string, string> = { MORNING: "Morning", NIGHT: "Night" };
const LOCATION_NAME: Record<string, string> = { ONLINE: "Online", OFFLINE: "Offline", TOTAL: "Total" };

function auditCells(a: AuditReportRow): (string | number)[] {
  return [
    a.product.category,
    a.product.sku ?? "",
    a.product.name,
    SHIFT_NAME[a.shift] ?? a.shift,
    LOCATION_NAME[a.location] ?? a.location,
    a.systemRemainingStock,
    a.manualCount,
    a.variance,
    a.remarks ?? "",
    a.isOpeningBalance ? "Opening balance" : a.published ? "Published" : "Not published",
  ];
}

function auditExcel(date: string, rows: AuditReportRow[]): string {
  return toExcelTable(AUDIT_COLUMNS, rows.map(auditCells), `AUDIT - ${date}`);
}
