import { useEffect, useMemo, useRef, useState } from "react";
import { getDailyReport, type DailyReport } from "../api/reports";
import { Button } from "../components/ui";
import { Dropdown } from "../components/Dropdown";
import { DatePicker } from "../components/DatePicker";
import { StockGrid, type GridRow } from "../components/StockGrid";
import { TotalStocksTable } from "../components/TotalStocksTable";
import { Toolbar, ToolbarControls } from "../components/Toolbar";
import { PageHeader } from "../components/PageHeader";
import { Toast } from "../components/Toast";
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

type ReportSection = "all" | "online" | "offline" | "total";

const SECTION_LABELS: Record<ReportSection, string> = {
  all: "Full Report (Online + Offline + Total)",
  online: "Online Only",
  offline: "Offline Only",
  total: "Total Stocks Only",
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
  const [error, setError] = useState<string | null>(null);
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
  const { user } = useAuth();
  const [generating, setGenerating] = useState(false);
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
  function load({ silent = false }: { silent?: boolean } = {}) {
    if (!silent) setError(null);

    // A report only reads saved data - staged edits for this date would be
    // silently left out of it.
    const unsaved = findUnsavedWork({ from: date, to: date });
    if (unsaved.length > 0) {
      if (!silent) setUnsavedWork(unsaved);
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
        // Only a fresh Generate remounts the grids (every category expanded
        // again); a silent refresh keeps whatever the person had collapsed.
        if (!silent) setReportVersion((v) => v + 1);
        if (!silent && searchParams.get("history") !== "1") {
          // Best effort - a failed history write should never surface as a
          // report-generation failure (see api/reportHistory.ts).
          recordReportHistory({
            type: "Daily Report",
            scope: nextReport.date,
            route: `/daily-report?history=1&date=${nextReport.date}`,
          }).catch(() => {});
        }
      })
      .catch((e) => {
        if (id !== requestId.current || silent) return;
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
  const byCategory = <T extends { product: { category: string } }>(
    rows: T[],
  ): T[] =>
    categoryFilter
      ? rows.filter((r) => r.product.category === categoryFilter)
      : rows;

  // Columns an encoder added to the live grids and saved individually come
  // back flattened onto these rows (server: utils/stockExtras.ts), so the
  // report can show the breakdown beside each total it adds up to. A date
  // with none of them leaves every column list - and so every table, PDF and
  // export - exactly as it was.
  const onlineExtras = useMemo(
    () => extraColumnsFromRows(report?.online as unknown as GridRow[] | null, onlineStockColumns),
    [report],
  );
  const offlineExtras = useMemo(
    () => extraColumnsFromRows(report?.offline as unknown as GridRow[] | null, offlineStockColumns),
    [report],
  );
  const onlineColumns = useMemo(() => columnsWithExtras(onlineStockColumns, onlineExtras), [onlineExtras]);
  const offlineColumns = useMemo(() => columnsWithExtras(offlineStockColumns, offlineExtras), [offlineExtras]);

  async function handleExport() {
    if (!report) return;
    const online = section(
      "ONLINE STOCK MONITORING",
      report.date,
      byCategory(report.online) as unknown as CsvSectionRow[],
      onlineColumns,
    );
    const offline = section(
      "OFFLINE STOCK MONITORING",
      report.date,
      byCategory(report.offline) as unknown as CsvSectionRow[],
      offlineColumns,
    );
    const total = totalSection(report.date, byCategory(report.total));

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
      downloadExcel(allName, [online, offline, total].join(""));
      return;
    }
    const bySection: Record<Exclude<ReportSection, "all">, string> = {
      online,
      offline,
      total,
    };
    const sectionName = `daily-report-${reportSection}-${report.date}.xls`;
    downloadExcel(sectionName, bySection[reportSection]);
  }

  // One PDF for whichever section(s) are selected, with the category filter
  // applied - the same rows Export Excel uses, laid out by utils/tablePdf.ts
  // (fixed page format, columns fitted to the page) instead of window.print().
  async function handlePdf() {
    if (!report) return;
    const sections: PdfSection[] = [];
    if (reportSection === "all" || reportSection === "online") {
      sections.push(
        stockGridSection(
          byCategory(report.online) as unknown as GridRow[],
          onlineColumns,
          { title: `ONLINE STOCK MONITORING - ${report.date}` },
        ),
      );
    }
    if (reportSection === "all" || reportSection === "offline") {
      sections.push(
        stockGridSection(
          byCategory(report.offline) as unknown as GridRow[],
          offlineColumns,
          { title: `OFFLINE STOCK MONITORING - ${report.date}` },
        ),
      );
    }
    if (reportSection === "all" || reportSection === "total") {
      sections.push(
        totalStocksSection(byCategory(report.total), {
          title: `TOTAL STOCKS - ${report.date}`,
        }),
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
        }),
      );
    } catch (e) {
      setError(e instanceof Error ? `PDF failed: ${e.message}` : "PDF failed");
    }
  }

  return (
    <div>
      <PageHeader
        title={`Daily Report - ${formatDateDisplay(date)}`}
        subtitle="Generate a printable snapshot of a given date's Online, Offline, and Total stock."
      >
        <Toolbar className="no-print">
          <div
            style={{
              display: "flex",
              gap: 8,
              alignItems: "center",
              flexWrap: "nowrap",
              minWidth: 0,
            }}
          >
            <DatePicker
              aria-label="Date"
              value={date}
              onChange={changeDate}
              todayValue={getCurrentShiftAndDate().date}
            />
            <Dropdown
              aria-label="Report section"
              value={reportSection}
              onChange={(v) => setReportSection(v as ReportSection)}
              title="Which section to view/export"
              options={(Object.keys(SECTION_LABELS) as ReportSection[]).map(
                (s) => ({ value: s, label: SECTION_LABELS[s] }),
              )}
            />
            {report && (
              <CategoryFilter
                categories={categories}
                value={categoryFilter}
                onChange={setCategoryFilter}
              />
            )}
            <Button onClick={() => load()} disabled={generating}>
              <PlayIcon /> {generating ? "Generating…" : "Generate"}
            </Button>
          </div>
          <ToolbarControls>
            {report && (
              <>
                <Button
                  variant="secondary"
                  onClick={handleExport}
                  title={
                    reportSection === "all"
                      ? "Export all sections as one Excel file"
                      : `Export just the ${SECTION_LABELS[reportSection]} as an Excel file`
                  }
                >
                  <DownloadIcon /> Export Excel
                </Button>
                <Button
                  variant="secondary"
                  onClick={handlePdf}
                  title="Download as PDF"
                >
                  <PrinterIcon /> PDF
                </Button>
              </>
            )}
            {user?.role === "SUPERVISOR_ADMIN" && (
              <Link
                to="/daily-report-history"
                className="ae-btn ae-btn-secondary"
                style={{ textDecoration: "none" }}
              >
                <HistoryIcon /> Daily History
              </Link>
            )}
          </ToolbarControls>
        </Toolbar>
      </PageHeader>

      <Toast
        message={error}
        onDismiss={() => setError(null)}
        variant="error"
        duration={null}
      />

      {report && (
        <div>
          {(reportSection === "all" || reportSection === "online") && (
            <>
              <h3 style={{ marginBottom: 8 }}>Online — {report.date}</h3>
              <div style={{ marginBottom: 32 }}>
                <StockGrid
                  key={`online-${reportVersion}`}
                  rows={byCategory(report.online) as unknown as GridRow[]}
                  columns={onlineStockColumns}
                  extraColumns={onlineExtras}
                  onCommit={noop}
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
                  rows={byCategory(report.offline) as unknown as GridRow[]}
                  columns={offlineStockColumns}
                  extraColumns={offlineExtras}
                  onCommit={noop}
                  readOnly
                />
              </div>
            </>
          )}

          {(reportSection === "all" || reportSection === "total") && (
            <>
              <h3 style={{ marginBottom: 8 }}>Total Stocks — {report.date}</h3>
              <TotalStocksTable
                key={`total-${reportVersion}`}
                rows={byCategory(report.total)}
              />
            </>
          )}
        </div>
      )}

      {!report && (
        <p style={{ fontSize: 13, color: colors.subtleInk }}>
          Pick a date and click Generate to build the report.
        </p>
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
    "Total Remaining",
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
  return toExcelTable(headers, excelRows, `TOTAL STOCKS - ${date}`);
}
