import { useState } from "react";
import { getDailyReport, type DailyReport } from "../api/reports";
import { Button, TextInput } from "../components/ui";
import { StockGrid, type GridRow } from "../components/StockGrid";
import { TotalStocksTable } from "../components/TotalStocksTable";
import { Toolbar } from "../components/Toolbar";
import { onlineStockColumns, offlineStockColumns } from "../config/stockColumns";
import { toCsv, downloadCsv } from "../utils/csv";
import { formatDateDisplay } from "../utils/dateFormat";
import { colors } from "../theme";

function today(): string {
  return new Date().toISOString().slice(0, 10);
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
  const [date, setDate] = useState(today());
  const [report, setReport] = useState<DailyReport | null>(null);
  const [error, setError] = useState<string | null>(null);

  function load() {
    setError(null);
    getDailyReport(date)
      .then(setReport)
      .catch((e) => setError(e instanceof Error ? e.message : "Failed to build report"));
  }

  function handleExport() {
    if (!report) return;
    const sections = [
      section("ONLINE STOCK MONITORING", report.date, report.online as unknown as CsvSectionRow[], onlineStockColumns),
      section("OFFLINE STOCK MONITORING", report.date, report.offline as unknown as CsvSectionRow[], offlineStockColumns),
      totalSection(report.date, report.total),
    ];
    // One file covering every section of the report, not one export per
    // table - a Daily Report is meaningless split across three separate
    // downloads that then have to be reassembled by hand.
    downloadCsv(`daily-report-${report.date}.csv`, sections.join("\r\n\r\n"));
  }

  return (
    <div>
      <Toolbar className="no-print">
        <h2 style={{ margin: 0 }}>Daily Report - {formatDateDisplay(date)}</h2>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <TextInput type="date" value={date} onChange={(e) => setDate(e.target.value)} />
          <Button onClick={load}>Generate</Button>
          {report && (
            <>
              <Button variant="secondary" onClick={handleExport}>
                Export CSV
              </Button>
              <Button variant="secondary" onClick={() => window.print()}>
                Print
              </Button>
            </>
          )}
        </div>
      </Toolbar>

      {error && <p style={{ color: colors.danger }}>{error}</p>}

      {report && (
        <div>
          <h3 style={{ marginBottom: 8 }}>Online — {report.date}</h3>
          <div style={{ marginBottom: 32 }}>
            <StockGrid rows={report.online as unknown as GridRow[]} columns={onlineStockColumns} onCommit={noop} readOnly />
          </div>

          <h3 style={{ marginBottom: 8 }}>Offline — {report.date}</h3>
          <div style={{ marginBottom: 32 }}>
            <StockGrid rows={report.offline as unknown as GridRow[]} columns={offlineStockColumns} onCommit={noop} readOnly />
          </div>

          <h3 style={{ marginBottom: 8 }}>Total Stocks — {report.date}</h3>
          <TotalStocksTable rows={report.total} />
        </div>
      )}

      {!report && <p style={{ fontSize: 13, color: colors.subtleInk }}>Pick a date and click Generate to build the report.</p>}
    </div>
  );
}

interface CsvSectionRow {
  product: { category: string; name: string };
  entry: Record<string, unknown>;
}

function section(title: string, date: string, rows: CsvSectionRow[], columns: { key: string; label: string }[]): string {
  const headers = ["Category", "Product", ...columns.map((c) => c.label)];
  const csvRows = rows.map((r) => [r.product.category, r.product.name, ...columns.map((c) => String(r.entry[c.key] ?? 0))]);
  return `${title} - ${date}\r\n${toCsv(headers, csvRows)}`;
}

function totalSection(date: string, rows: DailyReport["total"]): string {
  const headers = ["Category", "Product", "Online Remaining", "Offline Remaining", "Total Remaining", "Manual Count", "Variance"];
  const csvRows = rows.map((r) => [
    r.product.category,
    r.product.name,
    r.onlineRemainingStock,
    r.offlineRemainingStock,
    r.totalRemainingStock,
    r.totalManualCount ?? "",
    r.totalVariance ?? "",
  ]);
  return `TOTAL STOCKS - ${date}\r\n${toCsv(headers, csvRows)}`;
}
