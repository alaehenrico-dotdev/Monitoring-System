import { jsPDF } from "jspdf";
import autoTable, { type CellDef, type RowInput } from "jspdf-autotable";

/**
 * Plain tables as a landscape A4 PDF, for reports the server saves on its own
 * (the Daily Report in Google Drive). Black header bars on cream, like the PDFs
 * the app makes in the browser; one section per table, grouped by category when
 * the first column is "Category", page numbers in the footer.
 *
 * The same tables always produce the same bytes: the creation time and the file
 * id are fixed, nothing records when it was made. That is what lets an upload be
 * skipped when Drive already holds exactly this file.
 *
 * The built-in PDF fonts only cover Latin-1, so anything outside it (an arrow in
 * a column title, an em dash) is replaced by a plain equivalent instead of
 * printing as garbage.
 */

export type Cell = string | number | null | undefined;

export interface PdfTable {
  name: string;
  columns: string[];
  rows: Cell[][];
}

const BLACK: [number, number, number] = [12, 12, 12];
const CREAM: [number, number, number] = [255, 252, 245];
const BAND: [number, number, number] = [245, 192, 0];
const INK: [number, number, number] = [30, 30, 30];

/// A fixed moment, so a PDF made today and one made next month from the same
/// figures are byte-for-byte the same.
const FIXED_DATE = new Date(Date.UTC(2000, 0, 1));
const FIXED_FILE_ID = "0123456789ABCDEF0123456789ABCDEF";

const REPLACEMENTS: Record<string, string> = {
  "→": "->",
  "←": "<-",
  "—": "-",
  "–": "-",
  "‘": "'",
  "’": "'",
  "“": '"',
  "”": '"',
  "…": "...",
  " ": " ",
};

/// Text the standard PDF fonts can draw: control characters dropped, a few common
/// symbols swapped for plain ones, anything else outside Latin-1 shown as "?".
export function pdfText(value: string): string {
  let out = "";
  for (const ch of value) {
    const code = ch.codePointAt(0)!;
    if (code < 32 && code !== 10) continue;
    if (REPLACEMENTS[ch] !== undefined) out += REPLACEMENTS[ch];
    else out += code <= 255 ? ch : "?";
  }
  return out;
}

const num = new Intl.NumberFormat("en-US", { maximumFractionDigits: 2 });

/// Numbers with thousands separators (pinned to en-US so the PDF never depends on
/// the server's locale), nothing as a dash.
function cellText(value: Cell): string {
  if (value === null || value === undefined || value === "") return "-";
  return typeof value === "number" ? (Number.isFinite(value) ? num.format(value) : "-") : pdfText(String(value));
}

const isNumeric = (table: PdfTable, col: number) =>
  table.rows.length > 0 && table.rows.every((r) => r[col] === null || r[col] === undefined || r[col] === "" || typeof r[col] === "number");

export function renderTablesPdf(spec: { title: string; subtitle?: string; tables: PdfTable[] }): Buffer {
  const doc = new jsPDF({ orientation: "landscape", unit: "mm", format: "a4", compress: true });
  doc.setCreationDate(FIXED_DATE);
  doc.setFileId(FIXED_FILE_ID);
  doc.setProperties({ title: pdfText(`${spec.title}${spec.subtitle ? ` - ${spec.subtitle}` : ""}`), creator: "Ala Eh Stock Monitoring" });

  const margin = 10;
  const pageWidth = doc.internal.pageSize.getWidth();

  doc.setFont("helvetica", "bold").setFontSize(16).setTextColor(...INK);
  doc.text(pdfText(spec.title), margin, 16);
  if (spec.subtitle) {
    doc.setFont("helvetica", "normal").setFontSize(11);
    doc.text(pdfText(spec.subtitle), margin, 22);
  }
  let y = spec.subtitle ? 28 : 22;

  for (const table of spec.tables) {
    const [first] = table.columns;
    const grouped = first === "Category";
    const columns = grouped ? table.columns.slice(1) : table.columns;
    const body: RowInput[] = [];
    if (grouped) {
      let current: string | null = null;
      for (const row of table.rows) {
        const category = cellText(row[0]);
        if (category !== current) {
          current = category;
          const band: CellDef = { content: category, colSpan: columns.length, styles: { fontStyle: "bold", fillColor: BAND, textColor: BLACK, halign: "left" } };
          body.push([band]);
        }
        body.push(row.slice(1).map(cellText));
      }
    } else {
      for (const row of table.rows) body.push(row.map(cellText));
    }

    // A heading needs room for at least its header and a row after it; otherwise
    // it would sit alone at the foot of a page.
    if (y > doc.internal.pageSize.getHeight() - 30) {
      doc.addPage();
      y = 16;
    }
    doc.setFont("helvetica", "bold").setFontSize(11).setTextColor(...INK);
    doc.text(pdfText(table.name.toUpperCase()), margin, y);

    const offset = grouped ? 1 : 0;
    autoTable(doc, {
      startY: y + 2,
      margin: { left: margin, right: margin, bottom: 12 },
      head: [columns.map((c) => pdfText(c))],
      body: body.length ? body : [[{ content: "Nothing recorded.", colSpan: Math.max(columns.length, 1), styles: { halign: "left", fontStyle: "italic" } }]],
      theme: "grid",
      styles: { font: "helvetica", fontSize: 7, cellPadding: 1.2, lineColor: [200, 200, 200], lineWidth: 0.1, textColor: INK, overflow: "linebreak", valign: "middle" },
      headStyles: { fillColor: BLACK, textColor: CREAM, fontStyle: "bold", lineColor: BLACK },
      columnStyles: Object.fromEntries(
        columns.map((_, i) => [i, { halign: isNumeric(table, i + offset) ? ("right" as const) : ("left" as const) }]),
      ),
      // Repeat the header on every page the table runs onto.
      showHead: "everyPage",
    });
    y = ((doc as unknown as { lastAutoTable?: { finalY: number } }).lastAutoTable?.finalY ?? y) + 9;
  }

  // Footer: "Page n of N", added once the page count is known.
  const pages = doc.getNumberOfPages();
  doc.setFont("helvetica", "normal").setFontSize(8).setTextColor(110, 110, 110);
  for (let i = 1; i <= pages; i++) {
    doc.setPage(i);
    doc.text(`Page ${i} of ${pages}`, pageWidth - margin, doc.internal.pageSize.getHeight() - 5, { align: "right" });
  }

  return Buffer.from(doc.output("arraybuffer"));
}
