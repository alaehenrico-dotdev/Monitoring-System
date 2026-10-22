import { prisma } from "../lib/prisma";
import { toDateOnlyString } from "../utils/date";
import { buildXlsx, type Cell, type Sheet } from "../utils/xlsx";
import { getDailyOutflow } from "./dailyOutflow.service";
import { getDailyReport } from "./reports.service";

/**
 * The Daily Report as an Excel workbook, built on the server so it can be saved
 * to Google Drive with the nightly backup without anyone opening a browser.
 * Same content as the report page's own Excel export: Online, Offline and
 * Consolidated, plus Daily Out. The figures come from getDailyReport, so a
 * finished day is its frozen snapshot, exactly as the page shows it.
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

interface TotalRow {
  product: ProductRef;
  onlineRemainingStock: number;
  offlineRemainingStock: number;
  totalRemainingStock: number;
  totalManualCount?: number | null;
  totalVariance?: number | null;
}

/// Pure: the sheets for one report and its Daily Out figures.
export function dailyReportSheets(
  report: { online: unknown[]; offline: unknown[]; total: unknown[] },
  out: { onlineOut: number | null; offlineOut: number | null; totalOut: number | null } | null,
): Sheet[] {
  const total = report.total as TotalRow[];
  return [
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
