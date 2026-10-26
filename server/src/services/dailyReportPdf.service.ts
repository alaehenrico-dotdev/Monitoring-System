import { prisma } from "../lib/prisma";
import { toDateOnlyString } from "../utils/date";
import { extraCellKey, parseExtraCellKey } from "../utils/stockExtras";
import { renderTablesPdf, type Cell, type PdfTable } from "../utils/tablesPdf";
import { getDayExtraNames, type DayExtraNames } from "./extraColumnLabels.service";
import { getDailyOutflow } from "./dailyOutflow.service";
import { getDailyReport } from "./reports.service";

/**
 * The Daily Report as a PDF, built on the server so it can be saved to Google
 * Drive the moment a day is finished (or generated) without anyone opening a
 * browser. Same content as the report page: a summary saying whether the day is
 * finished, then Online, Offline, Consolidated, Daily Out and the day's Audit
 * counts. The figures come from getDailyReport, so a finished day is its frozen
 * snapshot, exactly as the page shows it.
 *
 * Nothing in the file depends on when it was built (no "generated at"), so the
 * same report always produces the same bytes - which is how an upload can tell
 * that Drive already holds exactly this file.
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

// Labels as on the entry pages (client/src/config/stockColumns.ts), which have no
// Upsell (Out) column - it is still stored and counted in Remaining Stocks, just not printed.
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
  ["remainingStock", "Remaining Stocks"],
];

const num = (v: unknown): number => {
  const n = Number(v ?? 0);
  return Number.isFinite(n) ? n : 0;
};

const productCells = (p: ProductRef): Cell[] => [p.category, p.sku ?? "", p.name];

/// The sheet's columns with the day's added columns right after the column each
/// one was added to - what the entry page and the report page show. They are not
/// in the fixed lists: each row carries them as `<column>__x<slot>` values, so the
/// slots in use are read off the rows. A typed name wins; otherwise "<label> +<slot>".
export function columnsWithExtras(rows: GridRow[], columns: [string, string][], names: Record<string, string> = {}): [string, string][] {
  const known = new Set(columns.map(([key]) => key));
  const slots = new Map<string, Set<number>>();
  for (const row of rows) {
    for (const key of Object.keys(row.entry)) {
      const parsed = parseExtraCellKey(key);
      if (!parsed || !known.has(parsed.columnKey)) continue;
      const set = slots.get(parsed.columnKey) ?? new Set<number>();
      set.add(parsed.slotIndex);
      slots.set(parsed.columnKey, set);
    }
  }
  return columns.flatMap(([key, label]): [string, string][] => [
    [key, label],
    ...[...(slots.get(key) ?? [])]
      .sort((a, b) => a - b)
      .map((slot): [string, string] => {
        const cellKey = extraCellKey(key, slot);
        const typed = names[cellKey]?.trim();
        return [cellKey, typed ? typed : `${label} +${slot}`];
      }),
  ]);
}

function stockSheet(name: string, rows: GridRow[], baseColumns: [string, string][], names: Record<string, string> = {}): PdfTable {
  const columns = columnsWithExtras(rows, baseColumns, names);
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
  extraNames?: DayExtraNames,
): PdfTable[] {
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
    stockSheet("Online", report.online as GridRow[], ONLINE_COLUMNS, extraNames?.ONLINE),
    stockSheet("Offline", report.offline as GridRow[], OFFLINE_COLUMNS, extraNames?.OFFLINE),
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
  return `daily-report-${date}.pdf`;
}

/// A day with nothing saved is not a report worth keeping.
function hasSavedRows(report: { online: unknown[]; offline: unknown[] }): boolean {
  return [...(report.online as GridRow[]), ...(report.offline as GridRow[])].some((r) => r.isSaved === true);
}

/// The PDF for `date`, or null when nothing has been saved for it.
export async function buildDailyReportPdf(date: Date): Promise<{ fileName: string; data: Buffer } | null> {
  const report = await getDailyReport(date);
  if (!hasSavedRows(report)) return null;
  const [out] = await getDailyOutflow(date, date);
  // Best effort, like the page: if the names cannot be read the added columns
  // still print, under their generic "+1" labels.
  const extraNames = await getDayExtraNames(date).catch(() => undefined);
  const iso = toDateOnlyString(date);
  const tables = dailyReportSheets({ ...report, date: iso }, out ?? null, extraNames);
  return { fileName: dailyReportFileName(iso), data: renderTablesPdf({ title: "Daily Report", subtitle: iso, tables }) };
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
