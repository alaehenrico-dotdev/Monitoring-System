import { prisma } from "../lib/prisma";
import { toDateOnlyString } from "../utils/date";
import { buildXlsx, type Cell, type Sheet } from "../utils/xlsx";
import { getDailyOutflow } from "./dailyOutflow.service";
import { getDailyReport } from "./reports.service";

/**
 * The Daily Report as an Excel workbook, built on the server so it can be saved
 * to Google Drive with the nightly backup without anyone opening a browser.
 * Same content as the report page's own Excel export: Online, Offline and
 * Consolidated, Daily Out and the day's Audit counts, behind a Summary sheet that
 * says whether the day is finished. The figures come from getDailyReport, so a
 * finished day is its frozen snapshot, exactly as the page shows it.
 *
 * Nothing in the workbook depends on when it was built (no "generated at"), so
 * the same report always produces the same bytes - which is how an upload can
 * tell that Drive already holds exactly this file.
 */

interface ProductRef {
  category: string;
  sku: string | null;
  name: string;
}
interface GridRow {
  product: ProductRef;
  entry: Record<string, unknown>;
  isSaved?: boolean;
}

// Labels as on the entry pages (client/src/config/stockColumns.ts).
const ONLINE_COLUMNS: [string, string][] = [
  ["openingStock", "Stocks (Opening)"],
  ["stockInOffToOl", "Stocks In (Off→Ol)"],
  ["stockOutOlToOff", "Stocks Out (Ol→Off)"],
  ["onlineStock", "Online Stocks"],
  ["productionIn", "Production (In)"],
  ["fulfillmentOut", "Fulfillment (Out)"],
  ["rts", "RTS"],
  ["remainingStock", "Remaining Stocks"],
];
const OFFLINE_COLUMNS: [string, string][] = [
  ["openingStock", "Stocks (Opening)"],
  ["stockInOlToOff", "Stocks In (Ol→Off)"],
  ["stockOutOffToOl", "Stocks Out (Off→Ol)"],
  ["offlineStock", "Offline Stocks"],
  ["productionIn", "Production (In)"],
  ["deliveryOut", "Delivery (Out)"],
  ["backloads", "Backloads"],
  ["upsellOut", "Upsell (Out)"],
  ["remainingStock", "Remaining Stocks"],
];

const num = (v: unknown): number => {
  const n = Number(v ?? 0);
  return Number.isFinite(n) ? n : 0;
};

const productCells = (p: ProductRef): Cell[] => [p.category, p.sku ?? "", p.name];

function stockSheet(name: string, rows: GridRow[], columns: [string, string][]): Sheet {
  return {
    name,
    columns: ["Category", "SKU", "Product", ...columns.map(([, label]) => label)],
    rows: rows.map((r) => [...productCells(r.product), ...columns.map(([key]) => num(r.entry[key]))]),
  };
}

interface AuditRow {
  product: ProductRef;
  shift: string;
  location: string;
  systemRemainingStock: number;
  manualCount: number;
  variance: number;
  remarks: string | null;
  published: boolean;
  isOpeningBalance: boolean;
}

const SHIFT_LABEL: Record<string, string> = { MORNING: "Morning", NIGHT: "Night" };
const LOCATION_LABEL: Record<string, string> = { ONLINE: "Online", OFFLINE: "Offline", TOTAL: "Total" };

interface TotalRow {
  product: ProductRef;
  onlineRemainingStock: number;
  offlineRemainingStock: number;
  totalRemainingStock: number;
  totalManualCount?: number | null;
  totalVariance?: number | null;
}

interface ReportInput {
  date?: string;
  online: unknown[];
  offline: unknown[];
  total: unknown[];
  audit?: unknown[];
  /// Set when this is the frozen copy saved at Finish day rather than live figures.
  snapshot?: { savedAt: string; savedBy: { name: string } | null } | null;
}

/// Pure: the sheets for one report and its Daily Out figures.
export function dailyReportSheets(
  report: ReportInput,
  out: { onlineOut: number | null; offlineOut: number | null; totalOut: number | null } | null,
): Sheet[] {
  const total = report.total as TotalRow[];
  const audit = (report.audit ?? []) as AuditRow[];
  const summary: Cell[][] = [
    ["Report date", report.date ?? ""],
    ["Status", report.snapshot ? "Finished - this is the report saved when the day was finished" : "Live - the day is not finished yet, so these figures can still change"],
    ...(report.snapshot ? ([["Saved at", report.snapshot.savedAt], ["Saved by", report.snapshot.savedBy?.name ?? ""]] as Cell[][]) : []),
    ["Audit counts", audit.length],
  ];
  return [
    { name: "Summary", columns: ["Item", "Value"], rows: summary },
    stockSheet("Online", report.online as GridRow[], ONLINE_COLUMNS),
    stockSheet("Offline", report.offline as GridRow[], OFFLINE_COLUMNS),
    {
      name: "Consolidated",
      columns: ["Category", "SKU", "Product", "Online Remaining", "Offline Remaining", "Consolidated Remaining", "Manual Count", "Variance"],
      rows: total.map((r) => [
        ...productCells(r.product),
        num(r.onlineRemainingStock),
        num(r.offlineRemainingStock),
        num(r.totalRemainingStock),
        r.totalManualCount ?? null,
        r.totalVariance ?? null,
      ]),
    },
    {
      name: "Daily Out",
      columns: ["Online Out", "Offline Out", "Combined Out"],
      rows: out ? [[out.onlineOut, out.offlineOut, out.totalOut]] : [],
    },
    {
      name: "Audit",
      columns: ["Category", "SKU", "Product", "Shift", "Location", "System Remaining", "Counted", "Variance", "Remarks", "Status"],
      rows: audit.map((a) => [
        ...productCells(a.product),
        SHIFT_LABEL[a.shift] ?? a.shift,
        LOCATION_LABEL[a.location] ?? a.location,
        num(a.systemRemainingStock),
        num(a.manualCount),
        num(a.variance),
        a.remarks ?? "",
        a.isOpeningBalance ? "Opening balance" : a.published ? "Published" : "Not published",
      ]),
    },
  ];
}

export function dailyReportFileName(date: string): string {
  return `daily-report-${date}.xlsx`;
}

/// A day with nothing saved is not a report worth keeping.
function hasSavedRows(report: { online: unknown[]; offline: unknown[] }): boolean {
  return [...(report.online as GridRow[]), ...(report.offline as GridRow[])].some((r) => r.isSaved === true);
}

/// The workbook for `date`, or null when nothing has been saved for it.
export async function buildDailyReportWorkbook(date: Date): Promise<{ fileName: string; data: Buffer } | null> {
  const report = await getDailyReport(date);
  if (!hasSavedRows(report)) return null;
  const [out] = await getDailyOutflow(date, date);
  const iso = toDateOnlyString(date);
  return { fileName: dailyReportFileName(iso), data: buildXlsx(dailyReportSheets(report, out ?? null)) };
}

/// The most recent date that has any Online or Offline entry, or null.
export async function latestEntryDate(): Promise<Date | null> {
  const [online, offline] = await Promise.all([
    prisma.dailyOnlineStock.aggregate({ _max: { entryDate: true } }),
    prisma.dailyOfflineStock.aggregate({ _max: { entryDate: true } }),
  ]);
  const dates = [online._max.entryDate, offline._max.entryDate].filter((d): d is Date => d !== null);
  return dates.length ? dates.reduce((a, b) => (a > b ? a : b)) : null;
}
