import { useEffect, useRef, useState } from "react";
import { getDailyReport, type DailyReport } from "../api/reports";
import { Button, Select, TextInput } from "../components/ui";
import { StockGrid, type GridRow } from "../components/StockGrid";
import { TotalStocksTable } from "../components/TotalStocksTable";
import { Toolbar, ToolbarControls } from "../components/Toolbar";
import { CategoryFilter } from "../components/CategoryFilter";
import { onlineStockColumns, offlineStockColumns } from "../config/stockColumns";
import { toExcelTable, downloadExcel } from "../utils/excel";
import { formatDateDisplay } from "../utils/dateFormat";
import { colors } from "../theme";
import { Link, useSearchParams } from "react-router-dom";
import { recordReportHistory } from "../utils/reportHistory";
import { PrinterIcon } from "../components/icons";

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

type ReportSection = "all" | "online" | "offline" | "total";

const SECTION_LABELS: Record<ReportSection, string> = {
  all: "Full Report (Online + Offline + Total)",
  online: "Online Only",
  offline: "Offline Only",
  total: "Total Stocks Only",
};

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

  useEffect(() => {
    if (searchParams.get("history") === "1") load();
    // History links intentionally generate the selected report once on open.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!report || !printAfterLoad.current) return;
    printAfterLoad.current = false;
    const frame = requestAnimationFrame(() => window.print());
    return () => cancelAnimationFrame(frame);
  }, [report]);

  function load() {
    setError(null);
    getDailyReport(date)
      .then((nextReport) => {
        setReport(nextReport);
        setReportVersion((v) => v + 1);
        if (searchParams.get("history") !== "1") {
          recordReportHistory({ type: "Daily Report", scope: nextReport.date, route: `/daily-report?history=1&date=${nextReport.date}` });
        }
      })
      .catch((e) => setError(e instanceof Error ? e.message : "Failed to build report"));
  }

  // Every category across all three sections (not just whichever section is
  // currently selected) - so switching the section dropdown doesn't also
  // reset an already-picked category filter to "no such option".
  const categories = report
    ? Array.from(new Set([...report.online, ...report.offline, ...report.total].map((r) => r.product.category))).sort()
    : [];
  const byCategory = <T extends { product: { category: string } }>(rows: T[]): T[] =>
    categoryFilter ? rows.filter((r) => r.product.category === categoryFilter) : rows;

  function handleExport() {
    if (!report) return;
    const online = section("ONLINE STOCK MONITORING", report.date, byCategory(report.online) as unknown as CsvSectionRow[], onlineStockColumns);
    const offline = section("OFFLINE STOCK MONITORING", report.date, byCategory(report.offline) as unknown as CsvSectionRow[], offlineStockColumns);
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
      downloadExcel(`daily-report-${report.date}.xls`, [online, offline, total].join(""));
      return;
    }
    const bySection: Record<Exclude<ReportSection, "all">, string> = { online, offline, total };
    downloadExcel(`daily-report-${reportSection}-${report.date}.xls`, bySection[reportSection]);
  }

  return (
    <div>
      <h2 style={{ margin: "-8px 0 0px" }}>Daily Report - {formatDateDisplay(date)}</h2>
      <p style={{ fontSize: 13, color: colors.subtleInk, margin: "0 0 8px" }}>
        Generate a printable snapshot of a given date's Online, Offline, and Total stock.
      </p>
      <Toolbar className="no-print">
        <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "nowrap", minWidth: 0 }}>
          <TextInput type="date" value={date} onChange={(e) => setDate(e.target.value)} />
          <Select aria-label="Report section" value={reportSection} onChange={(e) => setReportSection(e.target.value as ReportSection)} title="Which section to view/export">
            {(Object.keys(SECTION_LABELS) as ReportSection[]).map((s) => (
              <option key={s} value={s}>
                {SECTION_LABELS[s]}
              </option>
            ))}
          </Select>
          {report && <CategoryFilter categories={categories} value={categoryFilter} onChange={setCategoryFilter} />}
          <Button onClick={load}>Generate</Button>
        </div>
        <ToolbarControls>
          {report && (
            <>
              <Button variant="secondary" onClick={handleExport} title={reportSection === "all" ? "Export all sections as one Excel file" : `Export just the ${SECTION_LABELS[reportSection]} as an Excel file`}>
                Export Excel
              </Button>
              <Button variant="secondary" onClick={() => window.print()} title="Print or save as PDF">
                <PrinterIcon /> PDF
              </Button>
            </>
          )}
          <Link to="/daily-report-history" className="ae-btn ae-btn-secondary" style={{ textDecoration: "none" }}>
            Daily History
          </Link>
        </ToolbarControls>
      </Toolbar>

      {error && <p style={{ color: colors.danger }}>{error}</p>}

      {report && (
        <div>
          {(reportSection === "all" || reportSection === "online") && (
            <>
              <h3 style={{ marginBottom: 8 }}>Online — {report.date}</h3>
              <div style={{ marginBottom: 32 }}>
                <StockGrid key={`online-${reportVersion}`} rows={byCategory(report.online) as unknown as GridRow[]} columns={onlineStockColumns} onCommit={noop} readOnly />
              </div>
            </>
          )}

          {(reportSection === "all" || reportSection === "offline") && (
            <>
              <h3 style={{ marginBottom: 8 }}>Offline — {report.date}</h3>
              <div style={{ marginBottom: 32 }}>
                <StockGrid key={`offline-${reportVersion}`} rows={byCategory(report.offline) as unknown as GridRow[]} columns={offlineStockColumns} onCommit={noop} readOnly />
              </div>
            </>
          )}

          {(reportSection === "all" || reportSection === "total") && (
            <>
              <h3 style={{ marginBottom: 8 }}>Total Stocks — {report.date}</h3>
              <TotalStocksTable key={`total-${reportVersion}`} rows={byCategory(report.total)} />
            </>
          )}
        </div>
      )}

      {!report && <p style={{ fontSize: 13, color: colors.subtleInk }}>Pick a date and click Generate to build the report.</p>}
    </div>
  );
}

interface CsvSectionRow {
  product: { category: string; sku: string | null; name: string };
  entry: Record<string, unknown>;
}

function section(title: string, date: string, rows: CsvSectionRow[], columns: { key: string; label: string }[]): string {
  const headers = ["Category", "SKU", "Product", ...columns.map((c) => c.label)];
  const excelRows = rows.map((r) => [r.product.category, r.product.sku ?? "", r.product.name, ...columns.map((c) => String(r.entry[c.key] ?? 0))]);
  return toExcelTable(headers, excelRows, `${title} - ${date}`);
}

function totalSection(date: string, rows: DailyReport["total"]): string {
  const headers = ["Category", "SKU", "Product", "Online Remaining", "Offline Remaining", "Total Remaining", "Manual Count", "Variance"];
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