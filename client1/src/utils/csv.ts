/**
 * Minimal CSV helpers for the Online/Offline grid export & bulk-correction
 * import (Section 3.1: "Copy/paste of a block of numbers from an external
 * spreadsheet... is supported for bulk correction"). No library dependency -
 * the data here is simple (product names, categories, plain numbers), so a
 * small RFC4180-ish reader/writer covers it without pulling in a CSV package.
 */

export function toCsv(headers: string[], rows: (string | number)[][]): string {
  const escape = (value: string | number): string => {
    const s = String(value);
    return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return [headers, ...rows].map((row) => row.map(escape).join(",")).join("\r\n");
}

/// Parses CSV text into a 2D array of strings, handling quoted fields
/// (embedded commas/newlines/escaped "" quotes). Blank trailing lines are
/// dropped.
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;

  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += c;
      }
      continue;
    }

    if (c === '"') {
      inQuotes = true;
    } else if (c === ",") {
      row.push(field);
      field = "";
    } else if (c === "\n" || c === "\r") {
      if (c === "\r" && text[i + 1] === "\n") i++;
      row.push(field);
      field = "";
      if (row.some((cell) => cell !== "")) rows.push(row);
      row = [];
    } else {
      field += c;
    }
  }
  if (field !== "" || row.length) {
    row.push(field);
    if (row.some((cell) => cell !== "")) rows.push(row);
  }
  return rows;
}

/// Triggers a normal browser file download for the given CSV content.
export function downloadCsv(filename: string, content: string) {
  // A UTF-8 BOM so Excel (still the primary consumer of these files, per
  // Section 8.1) detects the encoding correctly instead of mangling any
  // non-ASCII characters in product/customer names.
  const blob = new Blob(["﻿" + content], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}
