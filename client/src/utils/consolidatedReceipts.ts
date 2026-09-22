import type { Product, Receipt } from "../types";
import { escapeHtml } from "./excel";
import type { PdfCell, PdfColumn, PdfRow, PdfSection } from "./pdfTables";
import { formatCount } from "./pdfTables";

/**
 * Section 4.7 - "Consolidated Receipt".
 *
 * The business already builds this by hand (see the "CONSOLIDATED RECEIPTS
 * MONITORING" sheet in the monthly Offline Receipts Audit workbook): for a
 * given delivery date, every individual Receipt becomes one column, every
 * product becomes one row (grouped by category, same as every other grid in
 * this app - StockGrid, TotalStocksTable, stockGridSection), and each cell
 * is that product's quantity on that receipt. Columns are further grouped by
 * `location` (the delivery area/route - e.g. "Bats New", "Cavite"), which is
 * how the hand-built sheet bands its customer columns.
 *
 * This is the same product catalog (categories/sortOrder) the Online/Offline
 * grids use, so - like stockGridSection/TotalStocksTable - every active
 * product is always listed, blank cells included, rather than only the ones
 * that happened to be ordered. That is what makes the grand-total row
 * comparable to a day's Fulfillment (Out) / Delivery (Out) figures: a
 * category with genuinely nothing ordered still shows a $0 subtotal instead
 * of silently disappearing from the sheet.
 */

/** One receipt, as a matrix column. */
export interface ConsolidatedColumn {
  receiptId: number;
  customer: string;
  location: string;
  /** "#018766" - matches the Receipt # shown on ReceiptsPage / the printed receipt. */
  receiptLabel: string;
  salesRepName: string | null;
}

export interface ConsolidatedProductRow {
  product: Product;
  /** Quantity for this product on each receipt, keyed by receiptId. Omitted (not 0) when there's no line item at all. */
  valuesByReceiptId: Record<number, number>;
  total: number;
}

export interface ConsolidatedCategoryGroup {
  category: string;
  rows: ConsolidatedProductRow[];
  subtotalByReceiptId: Record<number, number>;
  subtotalTotal: number;
}

export interface ConsolidatedLocationGroup {
  location: string;
  columns: ConsolidatedColumn[];
}

export interface ConsolidatedReceiptData {
  columns: ConsolidatedColumn[];
  locationGroups: ConsolidatedLocationGroup[];
  categoryGroups: ConsolidatedCategoryGroup[];
  /** Grand total (every category) per receipt - the "Total Order" figure the hand-built sheet keeps in its customer/legend table. */
  grandTotalByReceiptId: Record<number, number>;
  grandTotal: number;
}

function receiptLabel(id: number): string {
  return `#${String(id).padStart(6, "0")}`;
}

/**
 * Builds the full matrix from a flat list of Receipts (as returned by
 * listReceipts) and the active product catalog (listProducts).
 *
 * Columns are ordered by location (first-seen order in `receipts`, matching
 * the order every other grid groups by), then by receipt id ascending within
 * a location - the same order the delivery receipts themselves were issued
 * in, which is how the paper sheet orders its own columns.
 */
export function buildConsolidatedReceiptData(receipts: Receipt[], products: Product[]): ConsolidatedReceiptData {
  const locationOrder: string[] = [];
  const byLocation = new Map<string, Receipt[]>();
  for (const r of receipts) {
    const key = r.location || "(No location)";
    if (!byLocation.has(key)) {
      byLocation.set(key, []);
      locationOrder.push(key);
    }
    byLocation.get(key)!.push(r);
  }

  const locationGroups: ConsolidatedLocationGroup[] = locationOrder.map((location) => {
    const sorted = [...byLocation.get(location)!].sort((a, b) => a.id - b.id);
    return {
      location,
      columns: sorted.map((r) => ({
        receiptId: r.id,
        customer: r.customer,
        location: r.location,
        receiptLabel: receiptLabel(r.id),
        salesRepName: r.salesRepName,
      })),
    };
  });

  const columns = locationGroups.flatMap((g) => g.columns);

  // productId -> receiptId -> quantity, summed across that receipt's items
  // (a product normally appears at most once per receipt, but this sums
  // defensively rather than assuming that).
  const quantities = new Map<number, Map<number, number>>();
  for (const r of receipts) {
    for (const item of r.items) {
      const byReceipt = quantities.get(item.productId) ?? new Map<number, number>();
      byReceipt.set(r.id, (byReceipt.get(r.id) ?? 0) + item.quantity);
      quantities.set(item.productId, byReceipt);
    }
  }

  const categoryOrder: string[] = [];
  const byCategory = new Map<string, Product[]>();
  for (const p of products) {
    if (!p.isActive) continue;
    if (!byCategory.has(p.category)) {
      byCategory.set(p.category, []);
      categoryOrder.push(p.category);
    }
    byCategory.get(p.category)!.push(p);
  }

  const categoryGroups: ConsolidatedCategoryGroup[] = categoryOrder.map((category) => {
    const rows: ConsolidatedProductRow[] = byCategory.get(category)!.map((product) => {
      const byReceipt = quantities.get(product.id);
      const valuesByReceiptId: Record<number, number> = {};
      let total = 0;
      for (const col of columns) {
        const qty = byReceipt?.get(col.receiptId) ?? 0;
        if (qty !== 0) valuesByReceiptId[col.receiptId] = qty;
        total += qty;
      }
      return { product, valuesByReceiptId, total };
    });

    const subtotalByReceiptId: Record<number, number> = {};
    let subtotalTotal = 0;
    for (const col of columns) {
      const sum = rows.reduce((s, r) => s + (r.valuesByReceiptId[col.receiptId] ?? 0), 0);
      subtotalByReceiptId[col.receiptId] = sum;
      subtotalTotal += sum;
    }

    return { category, rows, subtotalByReceiptId, subtotalTotal };
  });

  const grandTotalByReceiptId: Record<number, number> = {};
  let grandTotal = 0;
  for (const col of columns) {
    const sum = categoryGroups.reduce((s, g) => s + (g.subtotalByReceiptId[col.receiptId] ?? 0), 0);
    grandTotalByReceiptId[col.receiptId] = sum;
    grandTotal += sum;
  }

  return { columns, locationGroups, categoryGroups, grandTotalByReceiptId, grandTotal };
}

/// Blank (not "0") for a zero cell - matches the hand-built sheet, where an
/// unordered product is simply left empty rather than printed as a zero.
export function formatQty(value: number | undefined): string {
  if (!value) return "";
  return value.toLocaleString("en-US");
}

/**
 * Which stock pool a receipt tallies against (Section 4.7's mutually
 * exclusive postToFulfillment / postToOfflineDelivery pair), for filtering
 * the consolidated view down to exactly the receipts that fed a given day's
 * Fulfillment (Out) or Delivery (Out) figure - so the grand total here can
 * be checked against that entry directly.
 */
export type ReceiptPool = "ALL" | "FULFILLMENT" | "OFFLINE_DELIVERY" | "NOT_POSTED";

export function receiptPool(r: Receipt): Exclude<ReceiptPool, "ALL"> {
  if (r.postToFulfillment) return "FULFILLMENT";
  if (r.postToOfflineDelivery) return "OFFLINE_DELIVERY";
  return "NOT_POSTED";
}

export function filterReceiptsByPool(receipts: Receipt[], pool: ReceiptPool): Receipt[] {
  if (pool === "ALL") return receipts;
  return receipts.filter((r) => receiptPool(r) === pool);
}

// ---------------------------------------------------------------------------
// Excel export
// ---------------------------------------------------------------------------

/**
 * Builds the matrix as a raw Excel-ready `<table>` (see utils/excel.ts's
 * "HTML table saved as .xls" trick - toExcelTable's flat headers/rows
 * signature can't express the grouped location header this needs, so this
 * builds the `<tr>`s directly instead).
 *
 * Three header rows (location band / customer / receipt #), one row per
 * product (grouped by category with a leading category band + trailing
 * subtotal, same as every other export in the app), and a grand-total row.
 */
export function toConsolidatedExcelTable(data: ConsolidatedReceiptData, title: string): string {
  const leadCols = 2; // Category/SKU, Product name
  const totalCols = leadCols + data.columns.length + 1; // + Total Order

  const titleRow = `<tr><th colspan="${totalCols}" style="text-align:left">${escapeHtml(title)}</th></tr>`;

  const locationRow = `<tr><th colspan="${leadCols}"></th>${data.locationGroups
    .map((g) => `<th colspan="${g.columns.length}">${escapeHtml(g.location)}</th>`)
    .join("")}<th></th></tr>`;

  const customerRow = `<tr><th>SKU</th><th>Product</th>${data.columns
    .map((c) => `<th>${escapeHtml(c.customer)}</th>`)
    .join("")}<th>Total Order</th></tr>`;

  const receiptRow = `<tr><th></th><th></th>${data.columns
    .map((c) => `<th>${escapeHtml(c.receiptLabel)}</th>`)
    .join("")}<th></th></tr>`;

  const bodyRows: string[] = [];
  for (const group of data.categoryGroups) {
    bodyRows.push(`<tr><td colspan="${totalCols}"><b>${escapeHtml(group.category)}</b></td></tr>`);
    for (const row of group.rows) {
      const cells = data.columns.map((c) => `<td>${escapeHtml(formatQty(row.valuesByReceiptId[c.receiptId]))}</td>`).join("");
      bodyRows.push(`<tr><td>${escapeHtml(row.product.sku ?? "")}</td><td>${escapeHtml(row.product.name)}</td>${cells}<td>${escapeHtml(formatQty(row.total))}</td></tr>`);
    }
    const subtotalCells = data.columns.map((c) => `<td><b>${escapeHtml(formatQty(group.subtotalByReceiptId[c.receiptId]))}</b></td>`).join("");
    bodyRows.push(`<tr><td colspan="2"><b>TOTAL - ${escapeHtml(group.category)}</b></td>${subtotalCells}<td><b>${escapeHtml(formatQty(group.subtotalTotal))}</b></td></tr>`);
  }

  const grandTotalCells = data.columns.map((c) => `<td><b>${escapeHtml(formatQty(data.grandTotalByReceiptId[c.receiptId]))}</b></td>`).join("");
  const grandTotalRow = `<tr><td colspan="2"><b>TOTAL ORDER</b></td>${grandTotalCells}<td><b>${escapeHtml(data.grandTotal)}</b></td></tr>`;

  return `<table border="1">${titleRow}${locationRow}${customerRow}${receiptRow}${bodyRows.join("")}${grandTotalRow}</table>`;
}

/**
 * The customer/receipt legend table (matches the small "Customer Name |
 * Receipt# | Total Order" list the hand-built sheet keeps next to the
 * matrix) - its own table, since a wide matrix of narrow columns reads a lot
 * less easily than a plain list once there are more than a handful of
 * receipts.
 */
export function toConsolidatedLegendExcelTable(data: ConsolidatedReceiptData, title: string): string {
  const headers = ["#", "Customer", "Location", "Receipt #", "Sales Rep", "Total Order"];
  const headRow = `<tr>${headers.map((h) => `<th>${escapeHtml(h)}</th>`).join("")}</tr>`;
  const rows = data.columns
    .map(
      (c, i) =>
        `<tr><td>${i + 1}</td><td>${escapeHtml(c.customer)}</td><td>${escapeHtml(c.location)}</td><td>${escapeHtml(c.receiptLabel)}</td><td>${escapeHtml(c.salesRepName ?? "")}</td><td>${escapeHtml(data.grandTotalByReceiptId[c.receiptId] ?? 0)}</td></tr>`,
    )
    .join("");
  return `<table border="1"><tr><th colspan="${headers.length}" style="text-align:left">${escapeHtml(title)}</th></tr>${headRow}${rows}</table>`;
}

// ---------------------------------------------------------------------------
// PDF export
// ---------------------------------------------------------------------------

/**
 * The matrix as a landscape PdfSection - built by hand (not via
 * stockGridSection) since its columns are dynamic (one per receipt) rather
 * than a fixed set. Receipt columns are labeled by receipt # only (not the
 * full customer name, which would blow out the column width across 20-30+
 * receipts) - pair it with consolidatedLegendSection so every receipt # is
 * still traceable to its customer.
 */
export function consolidatedMatrixSection(data: ConsolidatedReceiptData, options: { title?: string } = {}): PdfSection {
  const columns: PdfColumn[] = [
    { header: "SKU" },
    { header: "Product" },
    ...data.columns.map((c) => ({ header: c.receiptLabel, align: "right" as const })),
    { header: "Total", align: "right" as const },
  ];

  const rows: PdfRow[] = [];
  for (const group of data.categoryGroups) {
    rows.push({ kind: "group", cells: [group.category] });
    for (const r of group.rows) {
      const cells: PdfCell[] = [
        r.product.sku ?? "\u2014",
        r.product.name,
        ...data.columns.map((c) => formatQty(r.valuesByReceiptId[c.receiptId]) || "\u00B7"),
        { text: formatCount(r.total), bold: true },
      ];
      rows.push({ kind: "data", cells });
    }
    rows.push({
      kind: "subtotal",
      cells: [
        { text: `Subtotal - ${group.category}`, colSpan: 2 },
        ...data.columns.map((c) => formatQty(group.subtotalByReceiptId[c.receiptId]) || "\u00B7"),
        formatCount(group.subtotalTotal),
      ],
    });
  }

  if (data.columns.length > 0) {
    rows.push({
      kind: "total",
      cells: [
        { text: "GRAND TOTAL", colSpan: 2 },
        ...data.columns.map((c) => formatCount(data.grandTotalByReceiptId[c.receiptId])),
        formatCount(data.grandTotal),
      ],
    });
  }

  return { title: options.title, columns, rows, emptyMessage: "No receipts for this date." };
}

/** The customer/receipt legend, as a flat PdfSection (Total column pairs with consolidatedMatrixSection's receipt-# columns). */
export function consolidatedLegendSection(data: ConsolidatedReceiptData, options: { title?: string } = {}): PdfSection {
  return {
    title: options.title,
    columns: [
      { header: "#" },
      { header: "Customer" },
      { header: "Location" },
      { header: "Receipt #" },
      { header: "Sales Rep" },
      { header: "Total Order", align: "right" },
    ],
    rows: data.columns.map((c, i) => ({
      kind: "data",
      cells: [String(i + 1), c.customer, c.location, c.receiptLabel, c.salesRepName ?? "\u2014", formatCount(data.grandTotalByReceiptId[c.receiptId])],
    })),
    emptyMessage: "No receipts for this date.",
  };
}