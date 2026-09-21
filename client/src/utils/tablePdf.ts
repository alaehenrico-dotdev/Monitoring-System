/**
 * Client-side table PDF generator (jsPDF + jspdf-autotable).
 *
 * Replaces the old "PDF" buttons that called window.print(): printing the
 * page gave whatever the browser felt like - the sidebar/toolbar chrome
 * leaking in, columns cut off at the page edge, rows split across pages, and
 * a different result in every browser. Here the PDF is built from the same
 * row data the CSV / Excel exports use, so every report has:
 *
 *   - one page format (A4, portrait unless a caller asks for landscape),
 *   - columns that always span exactly the printable width (AutoTable sizes
 *     them from their content; text wraps instead of being cut off, and the
 *     font is stepped down if the columns still could not fit),
 *   - the table header repeated on every page and rows never split across a
 *     page break,
 *   - the same brand header / "Page X of Y" footer everywhere,
 *   - the same category / subtotal / grand-total styling as the grids.
 *
 * Calling `downloadTablePdf()` produces a real PDF and triggers a normal
 * "Save File" prompt - same experience as receiptPdf.ts.
 *
 * Dependencies (jsPDF is already installed for receipts):
 *   npm install jspdf-autotable
 */
// Type-only imports (erased at compile time, zero runtime cost) - the actual
// jspdf/jspdf-autotable modules are ~230KB combined and only needed at the
// moment someone actually clicks a "PDF" button, not on every route's
// initial load (every helper below only ever touches a `jsPDF` *instance*
// passed in as a parameter; the constructor and `autoTable()` itself are
// only called once, inside buildTablePdf, where they're dynamically
// imported instead - see the `import("jspdf")` call there).
import type jsPDF from "jspdf";
import type { RowInput, UserOptions } from "jspdf-autotable";
import type { PdfCell, PdfCellObject, PdfDocumentSpec, PdfSection, PdfTone } from "./pdfTables";

// ---- Page geometry (mm) ----
// Philippine offices print on both A4 and Letter; change this one constant
// to "letter" if that's what the printers are stocked with.
const PAGE_FORMAT = "a4";
const MARGIN_X = 10;
const MARGIN_BOTTOM = 13;
const FIRST_PAGE_TOP = 10;
/** Where a table starts on pages 2+ - leaves room for the running header. */
const CONT_TOP = 18;
const CELL_PAD_X = 1.8;
const CELL_PAD_Y = 1.2;
const MIN_FONT_SIZE = 6;

// ---- Palette (theme.ts `colors`, as RGB - the static values, not the CSS
// variables that flip with the light/dark toggle, since paper is always white) ----
type RGB = [number, number, number];
const INK: RGB = [36, 29, 20]; // #241D14
const MUTED: RGB = [107, 98, 85]; // #6B6255
const BLACK: RGB = [20, 17, 13]; // #14110D
const GOLD: RGB = [201, 154, 46]; // #C99A2E
const GOLD_DARK: RGB = [139, 106, 30]; // #8B6A1E
const CREAM: RGB = [241, 233, 208]; // #F1E9D0
const YELLOW: RGB = [255, 212, 0]; // #FFD400
const RED: RGB = [193, 39, 45]; // #C1272D
const GRID_LINE: RGB = [217, 207, 180];
const SUBTOTAL_FILL: RGB = [247, 241, 225];
const WARNING_FILL: RGB = [247, 231, 194]; // #F7E7C2

const TONE_COLOR: Record<PdfTone, RGB> = { danger: RED, warning: GOLD_DARK, muted: MUTED };

type StyleSet = NonNullable<UserOptions["styles"]>;

// ---------------------------------------------------------------------------
// Text safety
// ---------------------------------------------------------------------------

// jsPDF's built-in fonts only cover WinAnsi (Latin-1 plus a few punctuation
// marks). Anything else is drawn as garbage, so map or replace it up front.
const NOT_IN_WINANSI = /[^\u0020-\u007E\u00A0-\u00FF\u2013\u2014\u2018\u2019\u201C\u201D\u2022\u2026\u20AC\u2122]/g;

export function toPdfText(value: string | number): string {
  return String(value)
    .replace(/\u2192/g, "->") // "Stocks In (Off→Ol)" - arrows aren't in WinAnsi
    .replace(/\u2190/g, "<-")
    .replace(/[\u202F\u2009\u2007\u00A0]/g, " ") // ICU's narrow no-break spaces (e.g. in "1:15 PM")
    .replace(/[\r\n\t]+/g, " ")
    .replace(NOT_IN_WINANSI, "?");
}

// ---------------------------------------------------------------------------
// Layout helpers
// ---------------------------------------------------------------------------

function baseFontSize(columnCount: number): number {
  if (columnCount <= 5) return 9;
  if (columnCount <= 7) return 8.5;
  return 8;
}

function widestWord(doc: jsPDF, text: string): number {
  let widest = 0;
  for (const word of toPdfText(text).split(/\s+/)) {
    if (word) widest = Math.max(widest, doc.getTextWidth(word));
  }
  return widest;
}

function cellText(cell: PdfCell): string {
  return typeof cell === "object" ? String(cell.text) : String(cell);
}

/**
 * AutoTable never wraps inside a word, so if the longest word in every column
 * (header words and the un-wrappable numbers / SKU codes) adds up to more than
 * the printable width, the table would run off the page edge. Step the font
 * size down until the minimum widths fit - this is what guarantees "fitted"
 * for wide tables such as the 10-column Online / Offline grids.
 */
function fitFontSize(doc: jsPDF, section: PdfSection, availableWidth: number, start: number): number {
  const dataRows = section.rows.filter((r) => r.kind === "data");
  for (let size = start; size > MIN_FONT_SIZE; size -= 0.5) {
    doc.setFont("helvetica", "bold"); // widest style - conservative for the body too
    doc.setFontSize(size);
    let needed = 0;
    section.columns.forEach((col, ci) => {
      let min = widestWord(doc, col.header);
      for (const row of dataRows) {
        const cell = row.cells[ci];
        if (cell !== undefined) min = Math.max(min, widestWord(doc, cellText(cell)));
      }
      needed += min + CELL_PAD_X * 2;
    });
    if (needed <= availableWidth) return size;
  }
  return MIN_FONT_SIZE;
}

function asObject(cell: PdfCell): PdfCellObject {
  return typeof cell === "object" ? cell : { text: cell };
}

function buildBody(section: PdfSection): RowInput[] {
  const columnCount = section.columns.length;

  if (section.rows.length === 0) {
    return [
      [
        {
          content: toPdfText(section.emptyMessage ?? "No records to show."),
          colSpan: columnCount,
          styles: { halign: "center", textColor: MUTED, fontStyle: "italic" },
        },
      ],
    ];
  }

  return section.rows.map((row): RowInput => {
    if (row.kind === "group") {
      // Black + yellow, matching the on-screen category bar (StockGrid /
      // TotalStocksTable's categoryToggleStyle) and the brand seal itself -
      // the PDF used a neutral tan/cream band here before, which lost the
      // brand identity the rest of the app already carries.
      return [
        {
          content: toPdfText(cellText(row.cells[0] ?? "")),
          colSpan: columnCount,
          styles: { halign: "left", fontStyle: "bold", fillColor: BLACK, textColor: YELLOW },
        },
      ];
    }

    return row.cells.map((raw) => {
      const cell = asObject(raw);
      const styles: StyleSet = {};

      if (row.kind === "subtotal") {
        styles.fontStyle = "bold";
        styles.fillColor = SUBTOTAL_FILL;
      } else if (row.kind === "total") {
        styles.fontStyle = "bold";
        styles.fillColor = YELLOW;
        styles.textColor = INK;
      } else if (row.flagged) {
        styles.fillColor = WARNING_FILL;
      }

      // The label cell of a totals row ("Subtotal - X") reads left-to-right.
      if (cell.colSpan && cell.colSpan > 1) styles.halign = "left";
      if (cell.bold) styles.fontStyle = "bold";
      if (cell.tone) styles.textColor = TONE_COLOR[cell.tone];

      return {
        content: toPdfText(cell.text),
        ...(cell.colSpan && cell.colSpan > 1 ? { colSpan: cell.colSpan } : {}),
        styles,
      };
    });
  });
}

function lastTableBottom(doc: jsPDF): number | undefined {
  return (doc as unknown as { lastAutoTable?: { finalY?: number } }).lastAutoTable?.finalY;
}

// ---------------------------------------------------------------------------
// Page furniture
// ---------------------------------------------------------------------------

function generatedStamp(): string {
  return toPdfText(new Date().toLocaleString("en-US", { year: "numeric", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }));
}

/** Height (mm) of the black masthead bar drawn across the top of every page. */
const MASTHEAD_HEIGHT = 8;

/** The black-and-yellow bar every page opens with - same motif as the seal
 *  (black ring, yellow "Ala Eh!" lettering) instead of a plain white banner. */
function drawMasthead(doc: jsPDF, pageWidth: number, rightText: string) {
  doc.setFillColor(...BLACK);
  doc.rect(0, 0, pageWidth, MASTHEAD_HEIGHT, "F");
  doc.setFont("helvetica", "bold");
  doc.setFontSize(9);
  doc.setTextColor(...YELLOW);
  doc.text("ALA EH! FOOD PRODUCTS", MARGIN_X, MASTHEAD_HEIGHT / 2 + 1.4);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(7.5);
  doc.setTextColor(...CREAM);
  doc.text(rightText, pageWidth - MARGIN_X, MASTHEAD_HEIGHT / 2 + 1.2, { align: "right" });
}

/** Big brand + title block on page 1. Returns the y where content may start. */
function drawFirstPageHeader(doc: jsPDF, spec: PdfDocumentSpec, pageWidth: number): number {
  drawMasthead(doc, pageWidth, `Generated ${generatedStamp()}`);
  let y = FIRST_PAGE_TOP + MASTHEAD_HEIGHT;

  doc.setFont("helvetica", "bold");
  doc.setFontSize(15);
  doc.setTextColor(...INK);
  doc.text(toPdfText(spec.title), MARGIN_X, y);

  if (spec.subtitle) {
    y += 5.5;
    doc.setFont("helvetica", "normal");
    doc.setFontSize(10);
    doc.setTextColor(...MUTED);
    doc.text(toPdfText(spec.subtitle), MARGIN_X, y);
  }

  for (const note of spec.notes ?? []) {
    y += 4.2;
    doc.setFont("helvetica", "italic");
    doc.setFontSize(8);
    doc.setTextColor(...MUTED);
    doc.text(toPdfText(note), MARGIN_X, y);
  }

  y += 3;
  doc.setDrawColor(...GOLD);
  doc.setLineWidth(0.5);
  doc.line(MARGIN_X, y, pageWidth - MARGIN_X, y);

  return y + 5;
}

/** Section heading (e.g. "ONLINE STOCK MONITORING") - a black bar with
 *  yellow text, same weight as the category bars below it so the document's
 *  whole hierarchy of headings reads as one consistent black+yellow system. */
function drawSectionTitle(doc: jsPDF, title: string, y: number, pageWidth: number) {
  doc.setFillColor(...BLACK);
  doc.rect(MARGIN_X, y - 4.4, pageWidth - MARGIN_X * 2, 6.2, "F");
  doc.setFont("helvetica", "bold");
  doc.setFontSize(10.5);
  doc.setTextColor(...YELLOW);
  doc.text(toPdfText(title), MARGIN_X + 2.2, y);
}

/** Running header (pages 2+) and "Page X of Y" footer - needs the final page count, so it runs last. */
function drawPageChrome(doc: jsPDF, spec: PdfDocumentSpec, pageWidth: number, pageHeight: number) {
  const right = pageWidth - MARGIN_X;
  const total = doc.getNumberOfPages();

  for (let page = 1; page <= total; page++) {
    doc.setPage(page);

    if (page > 1) {
      drawMasthead(doc, pageWidth, toPdfText(spec.subtitle ?? spec.title));
      doc.setFont("helvetica", "bold");
      doc.setFontSize(9);
      doc.setTextColor(...INK);
      doc.text(toPdfText(spec.title), MARGIN_X, MASTHEAD_HEIGHT + 4.5);
      doc.setDrawColor(...GOLD);
      doc.setLineWidth(0.3);
      doc.line(MARGIN_X, MASTHEAD_HEIGHT + 6, right, MASTHEAD_HEIGHT + 6);
    }

    doc.setDrawColor(...GRID_LINE);
    doc.setLineWidth(0.2);
    doc.line(MARGIN_X, pageHeight - 9.5, right, pageHeight - 9.5);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(7.5);
    doc.setTextColor(...MUTED);
    doc.text("Ala Eh! Food Products - Stocks Monitoring System", MARGIN_X, pageHeight - 5.5);
    doc.text(`Page ${page} of ${total}`, right, pageHeight - 5.5, { align: "right" });
  }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/** Builds the PDF without saving it (handy for previewing or tests). */
export async function buildTablePdf(spec: PdfDocumentSpec): Promise<jsPDF> {
  const [{ default: JsPDF }, { autoTable }] = await Promise.all([import("jspdf"), import("jspdf-autotable")]);

  // Portrait by default, however many columns there are - wide tables get a
  // smaller font and wrapped text (see fitFontSize) instead of a landscape page.
  const orientation = spec.orientation === "landscape" ? "landscape" : "portrait";

  const doc = new JsPDF({ orientation, unit: "mm", format: PAGE_FORMAT, compress: true });
  doc.setProperties({
    title: toPdfText(spec.subtitle ? `${spec.title} - ${spec.subtitle}` : spec.title),
    creator: "Ala Eh! Stocks Monitoring System",
  });

  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();
  const availableWidth = pageWidth - MARGIN_X * 2;

  let y = drawFirstPageHeader(doc, spec, pageWidth);

  for (const section of spec.sections) {
    if (section.title) {
      // Keep a section heading together with the top of its table.
      if (y + 30 > pageHeight - MARGIN_BOTTOM) {
        doc.addPage();
        y = CONT_TOP;
      }
      drawSectionTitle(doc, section.title, y + 3.6, pageWidth);
      y += 9;
    }

    const fontSize = fitFontSize(doc, section, availableWidth, baseFontSize(section.columns.length));

    // The header cells share the columns' alignment so numbers line up under their labels.
    const head: RowInput[] = [
      section.columns.map((col) => ({
        content: toPdfText(col.header),
        styles: { halign: col.align ?? "left" },
      })),
    ];

    const columnStyles: NonNullable<UserOptions["columnStyles"]> = {};
    section.columns.forEach((col, ci) => {
      columnStyles[ci] = { halign: col.align ?? "left" };
    });

    autoTable(doc, {
      startY: y,
      margin: { top: CONT_TOP, right: MARGIN_X, bottom: MARGIN_BOTTOM, left: MARGIN_X },
      // Span the full printable width; columns are sized from their content.
      tableWidth: "auto",
      theme: "grid",
      showHead: "everyPage",
      rowPageBreak: "avoid",
      head,
      body: buildBody(section),
      styles: {
        font: "helvetica",
        fontSize,
        cellPadding: { top: CELL_PAD_Y, right: CELL_PAD_X, bottom: CELL_PAD_Y, left: CELL_PAD_X },
        textColor: INK,
        lineColor: GRID_LINE,
        lineWidth: 0.1,
        overflow: "linebreak",
        valign: "middle",
      },
      headStyles: { fillColor: BLACK, textColor: CREAM, fontStyle: "bold", lineColor: BLACK },
      columnStyles,
    });

    // If AutoTable didn't report where it ended, force the next section onto a fresh page rather than overdraw.
    y = (lastTableBottom(doc) ?? pageHeight) + 9;
  }

  drawPageChrome(doc, spec, pageWidth, pageHeight);
  return doc;
}

/** Builds the PDF and triggers the browser's normal "Save File" download. */
export async function downloadTablePdf(spec: PdfDocumentSpec): Promise<void> {
  (await buildTablePdf(spec)).save(spec.filename);
}