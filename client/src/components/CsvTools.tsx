import { useRef, useState } from "react";
import { downloadCsv, parseCsv, toCsv } from "../utils/csv";
import type { Product } from "../types";
import { colors } from "../theme";
import { DownloadIcon, PrinterIcon, UploadIcon } from "./icons";

export interface CsvColumn {
  key: string;
  label: string;
  editable?: boolean;
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
}

/**
 * Section 3.1 - "Copy/paste of a block of numbers from an external
 * spreadsheet into the grid is supported for bulk correction." Implemented
 * here as CSV export/import rather than literal clipboard paste: export
 * gives encoders a real file they can open in Excel, edit offline, and
 * re-import, which is the more common real-world bulk-correction workflow
 * than pasting a raw block of cells.
 */
export function CsvTools({ filenamePrefix, date, rows, columns, onImportRow, canImport }: CsvToolsProps) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  function handleExport() {
    const headers = ["Category", "Product", ...columns.map((c) => c.label)];
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

      const header = table[0].map((h) => h.trim().toLowerCase());
      const productIdx = header.indexOf("product");
      const categoryIdx = header.indexOf("category");
      if (productIdx === -1) throw new Error('Expected a "Product" column - re-export the grid and edit that file');

      const editableColumns = columns.filter((c) => c.editable);
      const columnIndexes = editableColumns
        .map((col) => ({ key: col.key, idx: header.indexOf(col.label.toLowerCase()) }))
        .filter((c) => c.idx !== -1);

      let updated = 0;
      let skipped = 0;
      let unchanged = 0;
      for (const line of table.slice(1)) {
        const productName = line[productIdx]?.trim();
        const category = categoryIdx !== -1 ? line[categoryIdx]?.trim() : undefined;
        // Product names repeat across categories (e.g. "Sweet A" exists in
        // both Class A (Liter) and Class A (Gallon)) - matching on category
        // too, when the column is present, avoids silently updating the
        // wrong SKU.
        const match = rows.find((r) => r.product.name === productName && (category === undefined || r.product.category === category));
        if (!match) {
          skipped++;
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
      setMessage(`${parts.join(", ")}.`);
    } catch (err) {
      setMessage(err instanceof Error ? `Import failed: ${err.message}` : "Import failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
      <div className="ae-segment-group" aria-label="Export/Import" title="Export/Import">
        <button type="button" className="ae-segment-btn" onClick={handleExport}>
          <UploadIcon />
          Export
        </button>
        <div className="ae-segment-divider" />
        <button
          type="button"
          className="ae-segment-btn"
          onClick={() => window.print()}
          title="Export as PDF (choose 'Save as PDF' in the print dialog)"
        >
          <PrinterIcon />
          PDF
        </button>
        {canImport && (
          <>
            <div className="ae-segment-divider" />
            <button type="button" className="ae-segment-btn" onClick={() => fileInputRef.current?.click()} disabled={busy}>
              <DownloadIcon />
              {busy ? "Importing…" : "Import"}
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
