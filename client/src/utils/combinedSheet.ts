import { findProductColumnIndex } from "./importMatch";

/**
 * Support for combined Online + Offline workbooks. Two layouts are read:
 *
 * 1. SIDE BY SIDE - the daily "CONSOLIDATED STOCKS" workbook, one sheet per
 *    day: SKU'S in column A, the OFFLINE STOCKS MONITORING block
 *    (BEGINNING, IN (FROM PROD), FROM BACKLOADS, the sales-agent columns,
 *    TOTAL OUT PER PRODUCT, ENDING FINAL STOCKS, MANUAL COUNT, VARIANCES) and
 *    then the ONLINE STOCKS MONITORING block (BEGINNING, IN (FROM PROD),
 *    FROM RTS, FULLFILMENT, ENDING FINAL STOCKS, MANUAL COUNT, VARIANCES),
 *    then CONSOLIDATED FINAL STOCKS. Both blocks reuse the same header names,
 *    so they are told apart by position, and category names sit in column A as
 *    rows of their own. Rebuilt here as an ordinary single-location table
 *    using this app's own column names.
 * 2. STACKED - one title row per table ("ONLINE STOCK MONITORING - 2026-10-14")
 *    followed by that table's own header row.
 *
 * Import is always for ONE location at a time (the Review modal, the change
 * log and Import History are all per location), so this keeps only the part
 * that belongs to the chosen location and reports what it left out. A file in
 * neither layout is an ordinary single-table file and passes through
 * untouched, so every existing import behaves exactly as before.
 */

export type SheetLocation = "ONLINE" | "OFFLINE";

export interface CombinedSheetSplit {
  /// The rows to import: the whole table for a plain file, otherwise only the
  /// chosen location's part.
  table: string[][];
  /// Whether the file held both locations at all.
  combined: boolean;
  /// Which sections the file contains (empty for a plain file).
  sectionsFound: SheetLocation[];
  /// Non-blank rows belonging to the other location(s), not read.
  skippedRows: number;
  layout: "plain" | "side-by-side" | "stacked";
  /// Side-by-side only: every product in the sheet's own order, with the
  /// category heading it sits under (from column A, whichever block it has
  /// figures in). What the product list is synced to.
  products?: SheetProduct[];
}

export interface SheetProduct {
  category: string;
  name: string;
}

export function splitCombinedSheet(table: string[][], location: SheetLocation): CombinedSheetSplit {
  return readSideBySide(table, location) ?? splitStacked(table, location);
}

/* ------------------------------------------------------------- stacked */

const SECTION_TITLE = /^\W*(online|offline)\b/i;

/// A section title is a short row (a title, maybe a date next to it) whose first
/// cell starts with Online/Offline and which is not itself a column-header row.
/// Product rows can't be mistaken for one: they carry numbers across the row.
function sectionOf(row: string[]): SheetLocation | null {
  const filled = row.map((c) => c.trim()).filter(Boolean);
  if (filled.length === 0 || filled.length > 2) return null;
  if (findProductColumnIndex(row) !== -1) return null;
  const match = SECTION_TITLE.exec(filled[0]);
  if (!match) return null;
  return match[1].toLowerCase() === "online" ? "ONLINE" : "OFFLINE";
}

const isBlank = (row: string[]) => row.every((c) => c.trim() === "");

function splitStacked(table: string[][], location: SheetLocation): CombinedSheetSplit {
  const titles = table
    .map((row, index) => ({ index, section: sectionOf(row) }))
    .filter((t): t is { index: number; section: SheetLocation } => t.section !== null);

  if (titles.length === 0) {
    return { table, combined: false, sectionsFound: [], skippedRows: 0, layout: "plain" };
  }

  const kept: string[][] = [];
  let skippedRows = 0;
  let headerSeen = false;
  titles.forEach((title, i) => {
    const end = i + 1 < titles.length ? titles[i + 1].index : table.length;
    const body = table.slice(title.index + 1, end);
    if (title.section !== location) {
      skippedRows += body.filter((r) => !isBlank(r)).length;
      return;
    }
    for (const row of body) {
      // A second section for the same location repeats the header row - keep
      // only the first, or "PRODUCTS" would be read as a product name.
      if (findProductColumnIndex(row) !== -1) {
        if (headerSeen) continue;
        headerSeen = true;
      }
      kept.push(row);
    }
  });

  return {
    table: kept,
    combined: true,
    sectionsFound: [...new Set(titles.map((t) => t.section))],
    skippedRows,
    layout: "stacked",
  };
}

/* --------------------------------------------------------- side by side */

/// Header text compared by letters only, so "IN (FROM PROD)", "In (from prod)"
/// and a stray double space are all the same label.
const key = (cell: string | undefined) => (cell ?? "").toLowerCase().replace(/[^a-z]/g, "");
const cellAt = (row: string[], i: number) => (row[i] ?? "").trim();

const ENDING = "endingfinalstocks";
const MANUAL = ["manualcount", "manualcounting"];

interface Block {
  /// The block's columns, named the way this app names them.
  columns: { label: string; col: number }[];
  /// Last column of the block (its VARIANCES).
  last: number;
  first: number;
}

/// Finds one location's columns inside [first, last] of the header row. Throws
/// a specific message rather than importing from a guess when a column the
/// import depends on is missing.
function locateBlock(
  header: string[],
  titleRows: string[][],
  first: number,
  last: number,
  location: SheetLocation,
): Block {
  const find = (what: string, ...names: string[]) => {
    for (let c = first; c <= last; c++) if (names.includes(key(header[c]))) return c;
    throw new Error(`The ${location} block has no "${what}" column`);
  };
  const prod = find("IN (FROM PROD)", "infromprod");
  const second =
    location === "OFFLINE"
      ? { label: "Backloads", col: find("FROM BACKLOADS", "frombackloads", "frombackload") }
      : { label: "RTS", col: find("FROM RTS", "fromrts") };
  const out =
    location === "OFFLINE"
      ? { label: "Delivery (Out)", col: find("TOTAL OUT PER PRODUCT", "totaloutperproduct") }
      : { label: "Fulfillment (Out)", col: find("FULLFILMENT", "fullfilment", "fulfillment", "fulfilment") };
  const ending = find("ENDING FINAL STOCKS", ENDING);
  const manual = find("MANUAL COUNT", ...MANUAL);

  // BEGINNING has no header cell of its own: it is merged down from the title
  // rows into the column just left of IN (FROM PROD).
  const beginning = prod - 1;
  if (!titleRows.some((r) => key(r[beginning]) === "beginning")) {
    throw new Error(`The ${location} block has no BEGINNING column`);
  }
  return {
    first,
    last,
    columns: [
      { label: "Stocks (Opening)", col: beginning },
      { label: "Production (In)", col: prod },
      second,
      out,
      { label: "Ending Final Stocks", col: ending },
      { label: "Manual Count", col: manual },
    ],
  };
}

/// The consolidated daily sheet, or null when `table` is not that layout.
function readSideBySide(table: string[][], location: SheetLocation): CombinedSheetSplit | null {
  const headerIdx = table.findIndex(
    (row, i) =>
      i < 20 &&
      row.filter((c) => key(c) === ENDING).length >= 2 &&
      row.filter((c) => MANUAL.includes(key(c))).length >= 2,
  );
  if (headerIdx === -1) return null;
  const header = table[headerIdx];
  const titleRows = table.slice(0, headerIdx);
  // The OFFLINE block ends at its VARIANCES column; the ONLINE block starts
  // right after it.
  const firstEnding = header.findIndex((c) => key(c) === ENDING);
  const split = header.findIndex((c, i) => i > firstEnding && key(c) === "variances");
  if (split === -1) return null;

  const offline = locateBlock(header, titleRows, 1, split, "OFFLINE");
  let lastHeader = header.length - 1;
  while (lastHeader > split && cellAt(header, lastHeader) === "") lastHeader--;
  const online = locateBlock(header, titleRows, split + 1, lastHeader, "ONLINE");
  const mine = location === "OFFLINE" ? offline : online;
  const other = location === "OFFLINE" ? online : offline;

  const out: string[][] = [["Product", ...mine.columns.map((c) => c.label), "Variances"]];
  let skippedRows = 0;
  const products: SheetProduct[] = [];
  let category = "";
  for (const row of table.slice(headerIdx + 1)) {
    const name = cellAt(row, 0);
    // The totals row has no SKU, and everything under it (footers, notes) is
    // not data.
    if (name === "" && row.filter((c) => c.trim() !== "").length >= 3) break;
    if (name === "") continue;

    const own = mine.columns.map((c) => cellAt(row, c.col));
    const variance = cellAt(row, mine.last);
    const blankHere = own.every((v) => v === "") && variance === "";
    const filledThere = other.columns.some((c) => cellAt(row, c.col) !== "");
    if (blankHere && !filledThere) {
      // Nothing on either side: a category heading ("PREMIUM (350 ML)"), which
      // the import tracks to tell same-named products apart.
      out.push([name]);
      category = name;
    } else if (blankHere) {
      // A product of the other location only. Left out rather than emitted as a
      // bare name, which the import would mistake for a category heading.
      skippedRows++;
    } else {
      out.push([name, ...own, variance]);
    }
    if (!(blankHere && !filledThere) && category) products.push({ category, name });
  }
  return { table: out, combined: true, sectionsFound: ["OFFLINE", "ONLINE"], skippedRows, layout: "side-by-side", products };
}
