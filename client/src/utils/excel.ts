/**
 * Excel export for Total Stocks and Manual Count (Section 4.4/4.5) - a real
 * .xls file Excel opens directly with proper columns/number formatting,
 * rather than the .csv this app's other exports use.
 *
 * No library dependency, matching csv.ts's own reasoning: this is the
 * decades-old "HTML table saved as .xls" trick (an HTML document, Excel's
 * own MIME type, and an .xls extension), which every version of Excel,
 * LibreOffice, and Google Sheets' importer already opens correctly - not a
 * hand-rolled sheet of the real, considerably more complex Office Open XML
 * .xlsx zip format, which would need an actual library to produce safely.
 */

/// Exported so other builders that need HTML-table cells Excel opens
/// correctly (e.g. consolidatedReceipts.ts's multi-row grouped header,
/// which toExcelTable's flat headers/rows signature can't express) don't
/// have to duplicate this.
export function escapeHtml(value: string | number): string {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

/// `title`, if given, becomes its own full-width row above the header row -
/// for a multi-section export (Daily Report) stacking several of these into
/// one file, so each section is still labeled once opened in Excel, the same
/// way the equivalent .csv puts a title line before each section's table.
export function toExcelTable(headers: string[], rows: (string | number)[][], title?: string): string {
  const titleRow = title ? `<tr><th colspan="${headers.length}" style="text-align:left">${escapeHtml(title)}</th></tr>` : "";
  const headRow = `<tr>${headers.map((h) => `<th>${escapeHtml(h)}</th>`).join("")}</tr>`;
  const bodyRows = rows
    .map((row) => `<tr>${row.map((cell) => `<td>${escapeHtml(cell)}</td>`).join("")}</tr>`)
    .join("");
  return `<table border="1">${titleRow}${headRow}${bodyRows}</table>`;
}

/// Triggers a normal browser file download for the given table(s) of HTML -
/// pass multiple `toExcelTable` outputs concatenated for more than one sheet
/// worth of tables stacked on a single page (Excel opens them as one sheet,
/// same as pasting several tables into one worksheet).
export function downloadExcel(filename: string, tablesHtml: string) {
  const html = `<html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:x="urn:schemas-microsoft-com:office:excel" xmlns="http://www.w3.org/TR/REC-html40"><head><meta charset="UTF-8" /></head><body>${tablesHtml}</body></html>`;
  // Same UTF-8 BOM as downloadCsv, for the same reason - correct encoding
  // detection for non-ASCII product/customer names.
  const blob = new Blob(["﻿" + html], { type: "application/vnd.ms-excel;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}