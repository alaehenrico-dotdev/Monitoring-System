/**
 * One-click end-of-day pack: the Daily Report PDF, the Variance Report PDF and
 * a database backup for ONE date, bundled into a single .zip.
 *
 * The two PDFs are laid out exactly like the ones the Daily Report and
 * Variance Report pages produce (same sections, columns, titles and file
 * names) - if either page's PDF layout changes, mirror it here.
 *
 * A step that fails does not stop the others: the pack is built from
 * whatever succeeded, and the caller gets every step's outcome so a missing
 * backup is reported rather than silently absent.
 */
import { getDailyReport, type DailyReport } from "../api/reports";
import { getVarianceReport } from "../api/manualCounts";
import { recordReportHistory } from "../api/reportHistory";
import { fetchDatabaseBackup } from "../api/backup";
import type { GridRow } from "../components/StockGrid";
import {
  columnsWithExtras,
  extraColumnsFromRows,
} from "../hooks/useExtraColumns";
import {
  offlineStockColumns,
  onlineStockColumns,
} from "../config/stockColumns";
import { buildTablePdf } from "./tablePdf";
import { createZip, type ZipInput } from "./zip";
import { formatDateDisplay } from "./dateFormat";
import {
  flatSection,
  pdfFileName,
  stockGridSection,
  totalStocksSection,
  type PdfCell,
  type PdfColumn,
} from "./pdfTables";

export type PackStepId = "daily" | "variance" | "backup" | "zip";
export type PackStepStatus = "running" | "done" | "skipped" | "error";

export interface PackOptions {
  /// "YYYY-MM-DD" business date.
  date: string;
  includeDaily: boolean;
  includeVariance: boolean;
  includeBackup: boolean;
  onStep?: (step: PackStepId, status: PackStepStatus, detail?: string) => void;
  onBackupProgress?: (bytesReceived: number) => void;
}

export interface PackResult {
  /// The zip, or null when no step produced a file.
  zip: Blob | null;
  zipName: string;
  files: { name: string; size: number }[];
  /// Steps that failed or were skipped, as human-readable lines.
  problems: string[];
}

interface VarianceRow {
  entryDate: string;
  location: string;
  systemRemainingStock: string;
  manualCount: string;
  variance: string;
  product: { id: number; sku: string | null; name: string; category: string };
  countedBy: { name: string } | null;
}

// Same columns, in the same order, as pages/VarianceReportPage.tsx.
const VARIANCE_PDF_COLUMNS: PdfColumn[] = [
  { header: "Date" },
  { header: "Location" },
  { header: "Category" },
  { header: "SKU" },
  { header: "Product" },
  { header: "System", align: "right" },
  { header: "Manual Count", align: "right" },
  { header: "Variance", align: "right" },
  { header: "Counted By" },
];

// Same "is there anything real in this report" test as DailyReportPage: a
// date nobody entered anything for still comes back as one unsaved row per
// product.
const NON_STOCK_KEYS = new Set(["productId", "entryDate", "shift"]);
function rowHasSavedData(row: { isSaved?: boolean; entry: object }): boolean {
  if (typeof row.isSaved === "boolean") return row.isSaved;
  return Object.entries(row.entry).some(
    ([k, v]) =>
      !NON_STOCK_KEYS.has(k) && Number(v) !== 0 && !Number.isNaN(Number(v)),
  );
}
function reportHasData(report: DailyReport): boolean {
  return (
    report.online.some(rowHasSavedData) ||
    report.offline.some(rowHasSavedData) ||
    report.total.some(
      (r) => r.totalManualCount !== null && r.totalManualCount !== undefined,
    )
  );
}

async function buildDailyPdf(
  date: string,
): Promise<{ blob: Blob; name: string } | null> {
  const report = await getDailyReport(date);
  if (report.date !== date)
    throw new Error("The server returned a report for a different date.");
  if (!reportHasData(report)) return null;

  const onlineRows = report.online as unknown as GridRow[];
  const offlineRows = report.offline as unknown as GridRow[];
  const onlineColumns = columnsWithExtras(
    onlineStockColumns,
    extraColumnsFromRows(onlineRows, onlineStockColumns),
  );
  const offlineColumns = columnsWithExtras(
    offlineStockColumns,
    extraColumnsFromRows(offlineRows, offlineStockColumns),
  );

  const pdf = await buildTablePdf({
    filename: pdfFileName("daily-report", report.date),
    title: "Daily Report",
    subtitle: formatDateDisplay(report.date),
    notes: [],
    sections: [
      stockGridSection(onlineRows, onlineColumns, {
        title: `ONLINE STOCK MONITORING - ${report.date}`,
      }),
      stockGridSection(offlineRows, offlineColumns, {
        title: `OFFLINE STOCK MONITORING - ${report.date}`,
      }),
      totalStocksSection(report.total, {
        title: `TOTAL STOCKS - ${report.date}`,
      }),
    ],
  });
  recordReportHistory({
    type: "Daily Report",
    scope: report.date,
    route: `/daily-report?history=1&date=${report.date}`,
    section: "all",
  }).catch(() => {});
  return {
    blob: pdf.output("blob"),
    name: pdfFileName("daily-report", report.date),
  };
}

async function buildVariancePdf(
  date: string,
): Promise<{ blob: Blob; name: string; count: number }> {
  const rows = (await getVarianceReport({
    startDate: date,
    endDate: date,
  })) as VarianceRow[];
  if (rows.some((r) => r.entryDate.slice(0, 10) !== date)) {
    throw new Error(
      "The server returned a variance for a different date than the one selected.",
    );
  }
  const name = pdfFileName("variance-report", date);
  const pdf = await buildTablePdf({
    filename: name,
    title: "Variance Report",
    subtitle: date,
    notes: [`${rows.length} flagged variance(s) found.`],
    sections: [
      flatSection(
        VARIANCE_PDF_COLUMNS,
        rows.map((r): PdfCell[] => [
          r.entryDate.slice(0, 10),
          r.location,
          r.product.category,
          r.product.sku ?? "\u2014",
          r.product.name,
          r.systemRemainingStock,
          r.manualCount,
          {
            text: r.variance,
            bold: true,
            tone: Number(r.variance) < 0 ? "danger" : "warning",
          },
          r.countedBy?.name ?? "\u2014",
        ]),
        { emptyMessage: "No flagged variances on this date." },
      ),
    ],
  });
  recordReportHistory({
    type: "Variance Report",
    scope: date,
    route: `/variance-report?history=1&date=${date}`,
  }).catch(() => {});
  return { blob: pdf.output("blob"), name, count: rows.length };
}

function message(e: unknown): string {
  return e instanceof Error ? e.message : "Unknown error";
}

export async function buildEndOfDayPack(
  opts: PackOptions,
): Promise<PackResult> {
  const { date, onStep } = opts;
  const inputs: ZipInput[] = [];
  const problems: string[] = [];

  if (opts.includeDaily) {
    onStep?.("daily", "running");
    try {
      const daily = await buildDailyPdf(date);
      if (daily) {
        inputs.push({ name: daily.name, data: daily.blob });
        onStep?.("daily", "done");
      } else {
        problems.push(
          `Daily Report skipped - no saved data for ${formatDateDisplay(date)}.`,
        );
        onStep?.("daily", "skipped", "No saved data for this date");
      }
    } catch (e) {
      problems.push(`Daily Report failed - ${message(e)}`);
      onStep?.("daily", "error", message(e));
    }
  }

  if (opts.includeVariance) {
    onStep?.("variance", "running");
    try {
      const variance = await buildVariancePdf(date);
      inputs.push({ name: variance.name, data: variance.blob });
      onStep?.("variance", "done", `${variance.count} flagged`);
    } catch (e) {
      problems.push(`Variance Report failed - ${message(e)}`);
      onStep?.("variance", "error", message(e));
    }
  }

  if (opts.includeBackup) {
    onStep?.("backup", "running");
    try {
      const backup = await fetchDatabaseBackup(opts.onBackupProgress);
      inputs.push({ name: backup.filename, data: backup.blob });
      onStep?.("backup", "done");
    } catch (e) {
      problems.push(`Database backup failed - ${message(e)}`);
      onStep?.("backup", "error", message(e));
    }
  }

  const zipName = `end-of-day-pack-${date}.zip`;
  if (inputs.length === 0) return { zip: null, zipName, files: [], problems };

  onStep?.("zip", "running");
  const zip = await createZip(inputs);
  onStep?.("zip", "done");
  return {
    zip,
    zipName,
    files: inputs.map((f) => ({ name: f.name, size: f.data.size })),
    problems,
  };
}
