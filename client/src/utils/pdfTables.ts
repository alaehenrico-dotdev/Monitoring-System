/**
 * Data layer for table PDFs - turns the same rows the CSV / Excel exports and
 * the on-screen grids already use into one neutral table model
 * (`PdfSection`), which `tablePdf.ts` then renders with jsPDF + AutoTable.
 *
 * Deliberately has NO jsPDF import, so it stays cheap to import from pages and
 * can be unit-tested on its own.
 *
 * Why a model in between instead of each page calling jsPDF directly: every
 * PDF in the app (Online / Offline entry, Total Stocks, Manual Count, Daily
 * Report, Variance Report) then has the same columns-to-cells mapping, the
 * same category grouping + subtotal + grand-total rows as the on-screen
 * grids, and the same number formatting - which is what makes the printed
 * output consistent from page to page.
 */
import type { TotalStockRow } from "../types";

export type PdfAlign = "left" | "center" | "right";
/** Colors a cell's text. Resolved to the brand palette in tablePdf.ts. */
export type PdfTone = "danger" | "warning" | "muted";

export interface PdfCellObject {
  text: string | number;
  /** Spans this many columns (e.g. "Subtotal - Category" over SKU + Product). */
  colSpan?: number;
  bold?: boolean;
  tone?: PdfTone;
}
export type PdfCell = string | number | PdfCellObject;

/**
 * data      a normal record
 * group     a category band - first cell is the label, spans every column
 * subtotal  per-category totals
 * total     the grand total row
 */
export type PdfRowKind = "data" | "group" | "subtotal" | "total";

export interface PdfRow {
  kind: PdfRowKind;
  cells: PdfCell[];
  /** Tints the row like the on-screen flagged/variance rows (warningBg). */
  flagged?: boolean;
}

export interface PdfColumn {
  header: string;
  align?: PdfAlign;
}

export interface PdfSection {
  /** Optional heading printed above the table (multi-section documents). */
  title?: string;
  columns: PdfColumn[];
  rows: PdfRow[];
  /** Shown instead of the table body when `rows` is empty. */
  emptyMessage?: string;
}

export interface PdfDocumentSpec {
  /** Full file name, e.g. from `pdfFileName(...)`. */
  filename: string;
  title: string;
  /** Second line under the title - usually the date (+ shift / location). */
  subtitle?: string;
  /** Small extra lines under the subtitle, e.g. the active filters. */
  notes?: string[];
  sections: PdfSection[];
  /** Portrait by default ("auto" is the same); pass "landscape" for a wide report. */
  orientation?: "auto" | "portrait" | "landscape";
}

// ---------------------------------------------------------------------------
// Formatting
// ---------------------------------------------------------------------------

/** Number coercion matching StockGrid's `toNum`: blank / null -> 0. */
export function num(value: unknown): number {
  if (value === null || value === undefined || value === "") return 0;
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

/**
 * Same display rules as the read-only grids: null / undefined / "" -> "—",
 * numbers get thousands separators. Pinned to en-US so the PDF never depends
 * on the viewer's browser locale (some locales group digits with a narrow
 * no-break space, which the PDF's built-in fonts can't draw).
 */
export function formatCount(value: unknown): string {
  if (value === null || value === undefined || value === "") return "\u2014";
  const n = Number(value);
  return Number.isFinite(n) ? n.toLocaleString("en-US") : String(value);
}

// ---------------------------------------------------------------------------
// Section builders
// ---------------------------------------------------------------------------

/** The shape shared by StockGrid rows and CsvTools rows. */
export interface PdfProductRow {
  product: { category: string; sku: string | null; name: string };
  entry: Record<string, unknown>;
  isFlagged?: boolean;
}

export interface StockSectionOptions {
  title?: string;
  /**
   * Which value columns get a subtotal / grand total. Defaults to all of them
   * (what StockGrid and Manual Count show). Total Stocks passes just the three
   * "remaining" columns, like TotalStocksTable.
   */
  sumKeys?: string[];
  /** Tints any row whose value under this key is non-zero (e.g. "variance"). */
  flagKey?: string;
}

function totalsRow(
  kind: "subtotal" | "total",
  label: string,
  columns: { key: string }[],
  rows: PdfProductRow[],
  sumKeys: Set<string>,
): PdfRow {
  return {
    kind,
    cells: [
      { text: label, colSpan: 2 },
      ...columns.map((c) => (sumKeys.has(c.key) ? formatCount(rows.reduce((sum, r) => sum + num(r.entry[c.key]), 0)) : "")),
    ],
  };
}

/**
 * The Online / Offline / Manual Count / generic-CSV table:
 * SKU | Product | ...value columns, grouped by category (in first-seen order,
 * same as the grids), each group closed by a subtotal, then a grand total.
 * Every category is always fully listed - unlike the screen there is nothing
 * to collapse on paper.
 */
export function stockGridSection(rows: PdfProductRow[], columns: { key: string; label: string }[], options: StockSectionOptions = {}): PdfSection {
  const sumKeys = new Set(options.sumKeys ?? columns.map((c) => c.key));

  const groups = new Map<string, PdfProductRow[]>();
  for (const row of rows) {
    const list = groups.get(row.product.category) ?? [];
    list.push(row);
    groups.set(row.product.category, list);
  }

  const out: PdfRow[] = [];
  for (const [category, groupRows] of groups) {
    out.push({ kind: "group", cells: [category] });
    for (const r of groupRows) {
      const flagged = !!r.isFlagged || (options.flagKey !== undefined && num(r.entry[options.flagKey]) !== 0);
      out.push({
        kind: "data",
        flagged,
        cells: [r.product.sku ?? "\u2014", r.product.name, ...columns.map((c) => formatCount(r.entry[c.key]))],
      });
    }
    out.push(totalsRow("subtotal", `Subtotal - ${category}`, columns, groupRows, sumKeys));
  }
  if (rows.length > 0) out.push(totalsRow("total", "GRAND TOTAL", columns, rows, sumKeys));

  return {
    title: options.title,
    columns: [{ header: "SKU" }, { header: "Product" }, ...columns.map((c) => ({ header: c.label, align: "right" as const }))],
    rows: out,
  };
}

/** Section 4.5's Total Stocks table - same layout as TotalStocksTable. */
export function totalStocksSection(rows: TotalStockRow[], options: { title?: string } = {}): PdfSection {
  const groups = new Map<string, TotalStockRow[]>();
  for (const row of rows) {
    const list = groups.get(row.product.category) ?? [];
    list.push(row);
    groups.set(row.product.category, list);
  }

  const sum = (list: TotalStockRow[], pick: (r: TotalStockRow) => number) => formatCount(list.reduce((s, r) => s + pick(r), 0));
  const totals = (kind: "subtotal" | "total", label: string, list: TotalStockRow[]): PdfRow => ({
    kind,
    cells: [
      { text: label, colSpan: 2 },
      sum(list, (r) => r.onlineRemainingStock),
      sum(list, (r) => r.offlineRemainingStock),
      sum(list, (r) => r.totalRemainingStock),
      "",
      "",
    ],
  });

  const out: PdfRow[] = [];
  for (const [category, groupRows] of groups) {
    out.push({ kind: "group", cells: [category] });
    for (const r of groupRows) {
      out.push({
        kind: "data",
        flagged: !!r.totalVariance,
        cells: [
          r.product.sku ?? "\u2014",
          r.product.name,
          formatCount(r.onlineRemainingStock),
          formatCount(r.offlineRemainingStock),
          { text: formatCount(r.totalRemainingStock), bold: true },
          formatCount(r.totalManualCount),
          formatCount(r.totalVariance),
        ],
      });
    }
    out.push(totals("subtotal", `Subtotal - ${category}`, groupRows));
  }
  if (rows.length > 0) out.push(totals("total", "GRAND TOTAL", rows));

  return {
    title: options.title,
    columns: [
      { header: "SKU" },
      { header: "Product" },
      { header: "Online Remaining", align: "right" },
      { header: "Offline Remaining", align: "right" },
      { header: "Total Remaining", align: "right" },
      { header: "Manual Count", align: "right" },
      { header: "Variance", align: "right" },
    ],
    rows: out,
  };
}

/** A plain, ungrouped table (Variance Report). */
export function flatSection(columns: PdfColumn[], rows: PdfCell[][], options: { title?: string; emptyMessage?: string } = {}): PdfSection {
  return {
    title: options.title,
    emptyMessage: options.emptyMessage,
    columns,
    rows: rows.map((cells) => ({ kind: "data" as const, cells })),
  };
}

// ---------------------------------------------------------------------------
// Small helpers for callers
// ---------------------------------------------------------------------------

/** "Category: X" / 'Search: "y"' lines for whichever filters are active, so a filtered PDF is never mistaken for the full list. */
export function filterNotes(filters: { category?: string; query?: string }): string[] {
  const notes: string[] = [];
  if (filters.category) notes.push(`Category: ${filters.category}`);
  if (filters.query?.trim()) notes.push(`Search: "${filters.query.trim()}"`);
  return notes;
}

/** ("online-stock", "2026-09-11", "MORNING") -> "online-stock-2026-09-11-morning.pdf" */
export function pdfFileName(...parts: (string | null | undefined)[]): string {
  const slug = parts
    .filter((p): p is string => !!p)
    .map((p) =>
      p
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-+|-+$/g, ""),
    )
    .filter(Boolean)
    .join("-");
  return `${slug || "report"}.pdf`;
}