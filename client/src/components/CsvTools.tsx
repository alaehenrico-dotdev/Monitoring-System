import { useRef, useState } from "react";
import { downloadCsv, parseCsv, toCsv } from "../utils/csv";
import type { Product } from "../types";
import { colors } from "../theme";
import { DownloadIcon, PrinterIcon, UploadIcon } from "./icons";

export interface CsvColumn {
  key: string;
  label: string;
  editable?: boolean;
  /// Extra header spellings this column should also be recognized under on
  /// import (see stockColumns.ts) - the real-world monthly reports this
  /// gets re-imported from use their own shorthand/typo'd header names
  /// ("STOCKS IN", "FULLFILMENT (OUT)") rather than the app's own export
  /// labels, and there's no reasonable way to derive one from the other.
  aliases?: string[];
  /// Recognized on import even when editable is false - see GridColumn's
  /// own doc comment (StockGrid.tsx) for why Opening Stock needs this.
  importable?: boolean;
}

/// Loosens a product/category name for comparison during import: lowercased
/// with all punctuation and whitespace stripped, so "CLASS A -(LITER)" and
/// "Class A (Liter)" (or "SWEET A" and "Sweet A") are recognized as the same
/// thing despite the case and punctuation differences a manually-maintained
/// spreadsheet tends to accumulate.
function normalizeForMatch(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]/g, "");
}

// A couple of category names the monthly report (Section 8.1) spells out
// differently enough that stripping punctuation alone doesn't bridge the
// gap - unlike everything else, this is a genuine wording difference
// ("3.785 Liters" vs the app's abbreviated "3.785L"), not just formatting.
// Keyed and valued by normalizeForMatch's own output.
const CATEGORY_ALIASES: Record<string, string> = {
  premium3785literspet: "premium3785lpet",
};

/// Like normalizeForMatch, but also resolves a category name through
/// CATEGORY_ALIASES first - used for every category comparison so a report
/// category and the app's own category are recognized as the same thing
/// regardless of which side (if either) needed the alias.
function categoryKey(s: string): string {
  const normalized = normalizeForMatch(s);
  return CATEGORY_ALIASES[normalized] ?? normalized;
}

interface CsvToolsProps {
  filenamePrefix: string;
  date: string;
  rows: { product: Product; entry: Record<string, unknown> }[];
  columns: CsvColumn[];
  /// Applies one imported row's editable values (already resolved to a
  /// productId) - the caller owns saving it and merging the result into
  /// local state, exactly like a manual cell edit would.
  onImportRow: (productId: number, values: Record<string, number>) => Promise<void>;
  /// Writers only - readers can still Export but shouldn't see Import.
  canImport: boolean;
  /// Hide the Export segment - e.g. a page that already has its own Export
  /// control and only wants this component for Import. Defaults to shown.
  showExport?: boolean;
  /// Hide the PDF segment - e.g. a page that already has its own PDF/print
  /// button and only wants this component for Import, so it isn't shown
  /// twice. Defaults to shown.
  showPdf?: boolean;
  /// Keeps the toolbar footprint stable while a grid is loading.
  disabled?: boolean;
  /// Disables just the PDF segment (Export/Import stay usable) - e.g. a
  /// page with unsaved edits, where a PDF taken now wouldn't reflect them
  /// yet. Defaults to false.
  pdfDisabled?: boolean;
  /// Runs before PDF/print - on the data entry pages this is where an
  /// unsaved-changes confirmation lives (Section 3.1), since printing the
  /// current page can otherwise ship a PDF of edits that were never
  /// actually saved. Resolving false cancels the print. Omit entirely on
  /// pages with nothing to stage first (e.g. read-only reports) - print
  /// then proceeds unconditionally, same as before this existed.
  onBeforePrint?: () => boolean | Promise<boolean>;
}

/**
 * Section 3.1 - "Copy/paste of a block of numbers from an external
 * spreadsheet into the grid is supported for bulk correction." Implemented
 * here as CSV export/import rather than literal clipboard paste: export
 * gives encoders a real file they can open in Excel, edit offline, and
 * re-import, which is the more common real-world bulk-correction workflow
 * than pasting a raw block of cells.
 */
export function CsvTools({
  filenamePrefix,
  date,
  rows,
  columns,
  onImportRow,
  canImport,
  showExport = true,
  showPdf = true,
  disabled = false,
  pdfDisabled = false,
  onBeforePrint,
}: CsvToolsProps) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  function handleExport() {
    // Uppercased to match the convention of the files people re-import (a
    // spreadsheet edited outside the app tends to use ALL-CAPS headers) -
    // parsing already lowercases before comparing (see handleImportFile),
    // so this is purely cosmetic and doesn't affect what re-imports.
    const headers = ["Category", "SKU", ...columns.map((c) => c.label)].map((h) => h.toUpperCase());
    const csvRows = rows.map((r) => [r.product.category, r.product.name, ...columns.map((c) => String(r.entry[c.key] ?? 0))]);
    downloadCsv(`${filenamePrefix}-${date}.csv`, toCsv(headers, csvRows));
  }

  async function handleImportFile(file: File) {
    setBusy(true);
    setMessage(null);
    try {
      const text = await file.text();
      const table = parseCsv(text);
      if (table.length < 2) throw new Error("File has no data rows");

      // The header is normally row 0, but a file that's been round-tripped
      // through Excel (or had a title/blank row pasted above it) can push
      // the real column headers down a row or two - scan down for whichever
      // row actually has a product-name cell in it instead of assuming row
      // 0, so those files still import instead of failing outright. Some
      // real-world exports (see Section 8.1) header this column "Products"
      // (plural) rather than "Product" - both spellings (and this app's own
      // "SKU"/"SKUs", per the Section 4.1 renaming) are accepted so neither
      // an old export nor the current business file re-imports.
      const headerRowIdx = table.findIndex((row) =>
        row.some((cell) => ["product", "products", "sku", "skus"].includes(cell.trim().toLowerCase())),
      );
      if (headerRowIdx === -1) throw new Error('Expected a "SKU" (or "Product") column - re-export the grid and edit that file');

      const header = table[headerRowIdx].map((h) => h.trim().toLowerCase());
      const productIdx = header.findIndex((h) => ["product", "products", "sku", "skus"].includes(h));
      const categoryIdx = header.indexOf("category");

      const editableColumns = columns.filter((c) => c.editable || c.importable);
      const columnIndexes = editableColumns
        .map((col) => {
          const names = [col.label, ...(col.aliases ?? [])].map((n) => n.toLowerCase());
          const idx = header.findIndex((h) => names.includes(h));
          return { key: col.key, idx };
        })
        .filter((c) => c.idx !== -1);

      let updated = 0;
      let skipped = 0;
      let unchanged = 0;
      // A few concrete examples of what failed to match, surfaced in the
      // result message below - "67 unmatched" alone gives no way to tell a
      // handful of genuinely-unrecognized rows (a discontinued product,
      // a totals line) apart from every row failing because the file's
      // naming doesn't line up with the product list at all.
      const unmatchedExamples: string[] = [];
      // Some monthly reports (see Section 8.1) have no Category column at
      // all - instead a category shows up as its own row (e.g.
      // "PREMIUM (350 ML)") with every stat column left blank, followed by
      // that category's products. Track the most recent one of those as an
      // implied category so a product name that repeats across sections
      // (e.g. "Toyo Mansi" exists in three different ones) still resolves
      // to the right SKU instead of whichever same-named row happens to
      // come first.
      let currentCategory: string | undefined;
      // The authoritative set of category names actually in the product
      // list, normalized the same way as everything else - checked first,
      // below, because a "blank stat columns" check alone isn't reliable:
      // the online report's own "Class A (Gallon)" header row carries stray
      // Production/Fulfillment/RTS subtotal figures (a spreadsheet
      // artifact), not blanks, but it's still a section header, not a
      // product named "Class A (Gallon)".
      const knownCategoryNames = new Set(rows.map((r) => categoryKey(r.product.category)));
      for (const line of table.slice(headerRowIdx + 1)) {
        const productName = line[productIdx]?.trim();
        if (!productName) continue;

        if (categoryIdx === -1 && knownCategoryNames.has(categoryKey(productName))) {
          currentCategory = productName;
          continue;
        }

        const hasAnyData = line.some((cell, i) => i !== productIdx && i !== categoryIdx && cell.trim() !== "");
        if (!hasAnyData) {
          if (categoryIdx === -1) currentCategory = productName;
          continue;
        }

        const category = categoryIdx !== -1 ? line[categoryIdx]?.trim() : currentCategory;
        // Normalized (lowercased, punctuation/whitespace stripped) on both
        // sides - the monthly report this also needs to import (Section
        // 8.1) is written entirely in ALL CAPS ("SWEET A", "CLASS A
        // (GALLON)") and isn't even internally consistent about punctuation
        // ("CLASS A -(LITER)" vs "CLASS A (GALLON)", no dash), while the
        // app's own product/category names are plain title case - an exact
        // === here would fail to match a single row from that file.
        // Product names repeat across categories (e.g. "Sweet A" exists in
        // both Class A (Liter) and Class A (Gallon)) - matching on category
        // too, when it's known (an explicit column, or an inferred section
        // header above), avoids silently updating the wrong SKU.
        const match = rows.find(
          (r) =>
            normalizeForMatch(r.product.name) === normalizeForMatch(productName) &&
            (category === undefined || categoryKey(r.product.category) === categoryKey(category)),
        );
        if (!match) {
          skipped++;
          if (unmatchedExamples.length < 3) unmatchedExamples.push(category ? `"${productName}" in "${category}"` : `"${productName}"`);
          continue;
        }

        // Only include values that actually differ from what's already on
        // the grid. A round-tripped export (open in Excel, tweak one cell,
        // re-import) otherwise resubmits every unchanged "0" as a real edit -
        // 60+ redundant writes (and change-log entries) for what's really a
        // one-cell correction.
        const values: Record<string, number> = {};
        for (const { key, idx } of columnIndexes) {
          const raw = line[idx];
          if (raw === undefined || raw.trim() === "") continue;
          const parsed = Number(raw);
          if (Number.isNaN(parsed)) continue;
          const current = Number(match.entry[key] ?? 0);
          if (parsed !== current) values[key] = parsed;
        }
        if (Object.keys(values).length === 0) {
          unchanged++;
          continue;
        }

        await onImportRow(match.product.id, values);
        updated++;
      }

      const parts = [`Imported ${updated} row${updated === 1 ? "" : "s"}`];
      if (unchanged) parts.push(`${unchanged} unchanged`);
      if (skipped) parts.push(`${skipped} unmatched`);
      let summary = `${parts.join(", ")}.`;
      if (unmatchedExamples.length) {
        summary += ` Unrecognized, e.g. ${unmatchedExamples.join(", ")}.`;
        // Show what's actually loaded side-by-side with what the file
        // said, rather than sending the user off to the SKUs admin page to
        // check by hand - if this list is empty, or its own names don't
        // resemble the "Unrecognized" examples above, that's the mismatch.
        summary +=
          rows.length === 0
            ? " No SKUs are currently loaded for this date/page, so nothing could match."
            : ` For comparison, ${rows.length} SKUs are loaded here, e.g. ${rows
                .slice(0, 3)
                .map((r) => `"${r.product.name}" in "${r.product.category}"`)
                .join(", ")}.`;
      }
      setMessage(summary);
    } catch (err) {
      setMessage(err instanceof Error ? `Import failed: ${err.message}` : "Import failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
      <div className="ae-segment-group" aria-label="Export/Import" title="Export/Import">
        {showExport && (
          <>
            <button type="button" className="ae-segment-btn" onClick={handleExport} disabled={disabled} title="Export">
              <UploadIcon />
              <span className="ae-segment-label">Export</span>
            </button>
            {showPdf && <div className="ae-segment-divider" />}
          </>
        )}
        {showPdf && (
          <button
            type="button"
            className="ae-segment-btn"
            onClick={async () => {
              if (onBeforePrint && !(await onBeforePrint())) return;
              window.print();
            }}
            disabled={disabled || pdfDisabled}
            title={pdfDisabled ? "Save your changes first - PDF reflects only saved data" : "Export as PDF (choose 'Save as PDF' in the print dialog)"}
          >
            <PrinterIcon />
            <span className="ae-segment-label">PDF</span>
          </button>
        )}
        {canImport && (
          <>
            {(showExport || showPdf) && <div className="ae-segment-divider" />}
            <button
              type="button"
              className="ae-segment-btn"
              onClick={() => fileInputRef.current?.click()}
              disabled={disabled || busy}
              title={busy ? "Importing…" : "Import"}
            >
              <DownloadIcon />
              <span className="ae-segment-label">{busy ? "Importing…" : "Import"}</span>
            </button>
            <input
              ref={fileInputRef}
              type="file"
              accept=".csv,text/csv"
              style={{ display: "none" }}
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) void handleImportFile(file);
                e.target.value = "";
              }}
            />
          </>
        )}
      </div>
      {message && <span style={{ fontSize: 12, color: colors.subtleInk }}>{message}</span>}
    </div>
  );
}
