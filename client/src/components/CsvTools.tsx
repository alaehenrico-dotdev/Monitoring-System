import { forwardRef, useImperativeHandle, useRef, useState } from "react";
import { motion } from "motion/react";
import { downloadCsv, parseCsv, toCsv } from "../utils/csv";
import {
  categoryKey,
  findHeaderRowIndex,
  findMatchingProduct,
  findProductColumnIndex,
  matchColumnIndexes,
  normalizeForMatch,
  unmatchedColumns,
  type ImportableColumn,
} from "../utils/importMatch";
import { downloadExcel, toExcelTable } from "../utils/excel";
import { downloadTablePdf } from "../utils/tablePdf";
import { pdfFileName, stockGridSection } from "../utils/pdfTables";
import { formatDateDisplay } from "../utils/dateFormat";
import type { Product } from "../types";
import { toolbarLayoutTransition } from "../motion";
import { DownloadIcon, PrinterIcon, UploadIcon } from "./icons";
import { Toast, type ToastVariant } from "./Toast";
import { useTopProgress } from "../hooks/useTopProgress";
import { Modal } from "./Modal";
import { PendingChangesPreview } from "./PendingChangesPreview";
import type { PendingChangeDetail } from "../hooks/usePendingEntryChanges";
import { Button } from "./ui";
import { colors } from "../theme";

// Same shape as importMatch.ts's ImportableColumn (which is what actually
// drives the header matching now - see handleImportFile below); kept as its
// own named type since callers (stockColumns.ts, GridColumn in
// StockGrid.tsx) already import CsvColumn by this name.
export type CsvColumn = ImportableColumn;

/// One row of the Review modal's matched list - a row that resolved to a
/// product AND had at least one value that actually differs from what's
/// currently on the grid (same "only include changed values" rule the old
/// inline import used).
interface MatchedImportRow {
  productId: number;
  productName: string;
  category: string;
  changes: Record<string, number>;
  /// From validateImport, if the caller supplied one - an advisory "this
  /// will likely be rejected at Save" reason, surfaced in the Review modal
  /// before the user ever clicks Save. Never blocks staging or Save itself
  /// (see validateImport's own doc comment on CsvToolsProps) - purely a
  /// heads-up so the eventual save failure isn't a surprise.
  warning?: string;
}

/// One row of the Review modal's unmatched list - every row that failed to
/// resolve to a product, not just a truncated handful of examples, since
/// this is now a scrollable list a user can act on rather than a one-line
/// toast.
interface UnmatchedImportRow {
  productName: string;
  category?: string;
  rawLineIndex: number;
}

interface ImportReview {
  matchedRows: MatchedImportRow[];
  unmatchedRows: UnmatchedImportRow[];
  /// Labels of columns this grid reads on import that weren't found
  /// anywhere in this file's header row at all (see unmatchedColumns) -
  /// distinct from a column that matched but had a blank cell for one row.
  missingColumns: string[];
}

/// Everything handleConfirmImport/acceptSuggestion need to re-derive a diff
/// after parsing has already finished and control has moved to the Review
/// modal - kept out of ImportReview's own state (whose shape is just what
/// the modal displays) and out of React state entirely, since it never
/// drives a render itself.
interface ImportParseContext {
  lines: string[][];
  columnIndexes: { key: string; idx: number }[];
  unchangedCount: number;
  fileName: string;
}

/// What the review modal's own Save actually staged, kept around just long
/// enough for a one-shot "Undo Import" (Section 3.1) - same lifetime as
/// `busy`/`message` (component state, not sessionStorage): fine to lose on
/// navigation/reload, same as the rest of an in-progress import would be.
interface ImportBatch {
  fileName: string;
  importedAt: number;
  /// productId -> key -> what Save changed it from/to, exactly as staged -
  /// used both to revert (oldValue) and to check nothing's touched the cell
  /// since (newValue, compared against getPendingValue).
  entries: Record<number, Record<string, { oldValue: number; newValue: number }>>;
}

/// Imperative handle so a page's own whole-grid Save (handleSaveAll, not
/// this component's review-modal Save) can tell CsvTools its last import
/// batch has actually been committed to the server and is no longer
/// "pending" - see notifyCommitted's own doc comment below for why this
/// can't just be inferred locally.
export interface CsvToolsHandle {
  notifyCommitted: () => void;
}

function levenshtein(a: string, b: string): number {
  if (a.length === 0) return b.length;
  if (b.length === 0) return a.length;
  const prevRow = new Array<number>(b.length + 1);
  for (let j = 0; j <= b.length; j++) prevRow[j] = j;
  for (let i = 1; i <= a.length; i++) {
    let prevDiag = prevRow[0];
    prevRow[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const temp = prevRow[j];
      prevRow[j] = a[i - 1] === b[j - 1] ? prevDiag : 1 + Math.min(prevDiag, prevRow[j], prevRow[j - 1]);
      prevDiag = temp;
    }
  }
  return prevRow[b.length];
}

/// A minimum similarity below which a "did you mean" suggestion does more
/// harm than good (attaching a receipt-style edit to an unrelated SKU).
const FUZZY_MATCH_THRESHOLD = 0.6;

/// Tolerant similarity used only for the Review modal's suggestion on an
/// unmatched row - normalizeForMatch's exact equality (the real match used
/// during parsing) is deliberately strict so a row is never silently
/// attached to the wrong SKU; this is purely to help a human decide, never
/// applied automatically.
function fuzzyScore(a: string, b: string): number {
  const na = normalizeForMatch(a);
  const nb = normalizeForMatch(b);
  if (!na || !nb) return 0;
  if (na === nb) return 1;
  return 1 - levenshtein(na, nb) / Math.max(na.length, nb.length);
}

function bestFuzzyMatch(name: string, candidates: Product[]): { product: Product; score: number } | null {
  let best: { product: Product; score: number } | null = null;
  for (const product of candidates) {
    const score = fuzzyScore(name, product.name);
    if (!best || score > best.score) best = { product, score };
  }
  return best && best.score >= FUZZY_MATCH_THRESHOLD ? best : null;
}

interface CsvToolsProps {
  filenamePrefix: string;
  date: string;
  rows: { product: Product; entry: Record<string, unknown> }[];
  columns: CsvColumn[];
  /// Applies one imported row's editable values (already resolved to a
  /// productId) - the caller owns saving it and merging the result into
  /// local state, exactly like a manual cell edit would. "Undo Import"
  /// reuses this same callback (see handleUndoImport) - reverting a cell is
  /// just staging its old value back through the normal path.
  onImportRow: (productId: number, values: Record<string, number>) => Promise<void>;
  /// Whatever the caller's own pending-changes state currently has staged
  /// for this exact cell, or undefined if nothing is - CsvTools has no
  /// direct access to that state itself. Used only by "Undo Import" to
  /// check a cell hasn't been touched by something else (a manual edit, a
  /// second import) since this one staged it, before reverting it.
  getPendingValue: (productId: number, key: string) => number | undefined;
  /// Optional advisory pre-check, run once per matched row while building
  /// the Review modal (and again when a fuzzy suggestion is accepted) -
  /// returns a warning string if this row's changes would likely be
  /// rejected server-side (e.g. the negative-stock guard), or undefined if
  /// it looks fine. Purely informational: this can't see everything the
  /// real save considers (a concurrent edit, the exact instant it runs), so
  /// it can under- or over-warn - it never blocks staging or Save, only
  /// surfaces the reason before Save is clicked instead of only after it
  /// fails. Omit entirely on a page with no such risk to check for.
  validateImport?: (productId: number, changes: Record<string, number>) => string | undefined;
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
  /// "csv" (default) keeps the plain, re-importable .csv this grid's Import
  /// segment expects. "excel" instead downloads a real .xls file Excel opens
  /// directly - for read-only tables (Total Stocks, Manual Count) that never
  /// import, so their export doesn't need to stay in a round-trippable
  /// format. Ignored when `canImport` is true, since re-import always parses
  /// CSV, never this .xls.
  exportFormat?: "csv" | "excel";
  /// What the PDF segment produces. The PDF is built from the same `rows` and
  /// `columns` as Export (via utils/tablePdf.ts, not by printing the page),
  /// so all the formats agree. Everything here is optional - the title
  /// defaults to the file prefix and the subtitle to the date.
  pdf?: {
    title?: string;
    subtitle?: string;
    /// Small extra lines under the subtitle (e.g. active filters).
    notes?: string[];
    /// Which value columns get subtotals / a grand total. Defaults to all.
    sumKeys?: string[];
    /// Tints rows whose value under this key is non-zero (e.g. "variance").
    flagKey?: string;
  };
}

/// One row of the Review modal's unmatched list - the raw name/category the
/// file had, plus a fuzzy "did you mean" suggestion computed fresh on every
/// render (so it always reflects the current product list) that the user
/// can accept to fold this row into the matched list above.
function UnmatchedImportRowView({
  row,
  candidates,
  onAccept,
}: {
  row: UnmatchedImportRow;
  candidates: Product[];
  onAccept: (rawLineIndex: number, product: Product) => void;
}) {
  const suggestion = bestFuzzyMatch(row.productName, candidates);
  return (
    <div style={{ padding: "8px 0", borderBottom: `1px solid ${colors.border}` }}>
      <div style={{ fontSize: 13, color: colors.ink }}>
        “{row.productName}”{row.category ? <span style={{ color: colors.subtleInk }}> in “{row.category}”</span> : null}
      </div>
      {suggestion ? (
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 4, fontSize: 12.5, color: colors.subtleInk }}>
          <span>
            Use “{suggestion.product.name}” instead?
          </span>
          <Button type="button" variant="secondary" size="sm" onClick={() => onAccept(row.rawLineIndex, suggestion.product)}>
            Accept
          </Button>
        </div>
      ) : (
        <div style={{ marginTop: 4, fontSize: 12.5, color: colors.subtleInk }}>No match found.</div>
      )}
    </div>
  );
}

/**
 * Export always dumps every column (Section 3.1's Excel-like round-trip
 * file). Import is narrower: it only ever reads and writes Opening Stock
 * (from that file's own Opening Stock or, more commonly, its Remaining
 * Stock / ending-balance column - see handleImportFile). Every other cell
 * (Stock In/Out, Production, per-destination delivery, Upsell, Backloads)
 * starts at 0 each day and is meant to be entered fresh as that day's real
 * activity happens - re-importing an old file must never fabricate those
 * from a different day's own figures. Encoders still get a real file they
 * can open in Excel and re-import purely to seed/correct Opening Stock from
 * existing data (e.g. the last pre-system report, or a day that had none).
 */
export const CsvTools = forwardRef<CsvToolsHandle, CsvToolsProps>(function CsvTools({
  filenamePrefix,
  date,
  rows,
  columns,
  onImportRow,
  getPendingValue,
  validateImport,
  canImport,
  showExport = true,
  showPdf = true,
  disabled = false,
  pdfDisabled = false,
  onBeforePrint,
  exportFormat = "csv",
  pdf,
}, ref) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const progress = useTopProgress();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [messageVariant, setMessageVariant] = useState<ToastVariant>("info");
  // Parsing (busy) and Save (savingImport) are two separate, sequential
  // steps now - see handleImportFile/handleConfirmImport - so each gets its
  // own in-flight flag rather than one covering both.
  const [importReview, setImportReview] = useState<ImportReview | null>(null);
  const [savingImport, setSavingImport] = useState(false);
  const importContextRef = useRef<ImportParseContext | null>(null);
  // The most recent review-modal Save, revertible via "Undo Import" until
  // either a second import overwrites it (one level only, same rule as the
  // page's own per-save Undo) or notifyCommitted says it's been superseded
  // by a real, already-saved edit (see CsvToolsHandle above).
  const [lastImportBatch, setLastImportBatch] = useState<ImportBatch | null>(null);
  // Whether the *current* toast message is the one "Undo Import" belongs to
  // - kept separate from lastImportBatch itself (which can outlive its own
  // toast) so the action doesn't show up again next to some later, unrelated
  // message while a stale-but-not-yet-superseded batch still exists.
  const [showUndoImport, setShowUndoImport] = useState(false);
  const undoInFlightRef = useRef(false);
  const asExcel = exportFormat === "excel" && !canImport;

  useImperativeHandle(ref, () => ({
    // Called by the page's own whole-grid Save (handleSaveAll), never by
    // anything in this file - once that Save actually commits an imported
    // cell to the server, lastImportBatch's "oldValue -> newValue" is no
    // longer describing a pending edit at all, so re-staging oldValue via
    // Undo Import at that point would create a brand-new, real change
    // instead of just dropping a still-pending one back to baseline.
    notifyCommitted: () => {
      setLastImportBatch(null);
      setShowUndoImport(false);
    },
  }));

  function handleExport() {
    if (asExcel) {
      // The real SKU code gets its own column here, alongside the product
      // name - unlike the CSV path below, nothing re-imports an Excel
      // export, so there's no "SKU" alias to preserve for a parser to match
      // against (see handleImportFile's productIdx lookup).
      const headers = ["Category", "SKU", "Product", ...columns.map((c) => c.label)];
      const dataRows = rows.map((r) => [r.product.category, r.product.sku ?? "", r.product.name, ...columns.map((c) => String(r.entry[c.key] ?? 0))]);
      downloadExcel(`${filenamePrefix}-${date}.xls`, toExcelTable(headers, dataRows));
      return;
    }
    // Uppercased to match the convention of the files people re-import (a
    // spreadsheet edited outside the app tends to use ALL-CAPS headers) -
    // parsing already lowercases before comparing (see handleImportFile),
    // so this is purely cosmetic and doesn't affect what re-imports. "SKU"
    // here is still the product name, not the real sku code - re-import
    // matches products by this column (see productIdx below) and the code
    // alone isn't always present/typed by whoever edited the file offline.
    const headers = ["Category", "SKU", ...columns.map((c) => c.label)].map((h) => h.toUpperCase());
    const dataRows = rows.map((r) => [r.product.category, r.product.name, ...columns.map((c) => String(r.entry[c.key] ?? 0))]);
    downloadCsv(`${filenamePrefix}-${date}.csv`, toCsv(headers, dataRows));
  }

  async function handlePdf() {
    if (onBeforePrint && !(await onBeforePrint())) return;
    try {
      // No real byte/row progress for a synchronous local PDF build (Section:
      // Loading system) - track() eases the bar toward 90% and holds it
      // there for as long as this actually takes, instead of a fake timer.
      await progress.track(() =>
        downloadTablePdf({
          filename: pdfFileName(filenamePrefix, date),
          title: pdf?.title ?? filenamePrefix.replace(/-/g, " ").replace(/\b\w/g, (c) => c.toUpperCase()),
          subtitle: pdf?.subtitle ?? formatDateDisplay(date),
          notes: pdf?.notes,
          sections: [stockGridSection(rows, columns, { sumKeys: pdf?.sumKeys, flagKey: pdf?.flagKey })],
        }),
      );
    } catch (err) {
      setMessage(err instanceof Error ? `PDF failed: ${err.message}` : "PDF failed");
      setMessageVariant("error");
      setShowUndoImport(false);
    }
  }

  async function handleImportFile(file: File) {
    setBusy(true);
    setMessage(null);
    setShowUndoImport(false);
    try {
      const text = await file.text();
      const table = parseCsv(text);
      if (table.length < 2) throw new Error("File has no data rows");

      // See findHeaderRowIndex's own doc comment: a file that's been
      // round-tripped through Excel (or had a title/blank row pasted above
      // it - exactly what the monthly report's own layout looks like) can
      // push the real column headers down a row or two. Some real-world
      // exports (Section 8.1) header this column "Products" (plural) rather
      // than "Product" - both spellings (and this app's own "SKU"/"SKUs",
      // per the Section 4.1 renaming) are accepted so neither an old export
      // nor the current business file fails to import.
      const headerRowIdx = findHeaderRowIndex(table);
      if (headerRowIdx === -1) throw new Error('Expected a "SKU" (or "Product") column - re-export the grid and edit that file');

      const header = table[headerRowIdx].map((h) => h.trim().toLowerCase());
      const productIdx = findProductColumnIndex(header);
      const categoryIdx = header.indexOf("category");

      // Import only ever writes Opening Stock. Every other cell (Stock In/
      // Out, Production, per-destination delivery, Upsell, Backloads, ...)
      // starts at 0 each day and is meant to be entered fresh as that day's
      // real activity happens - importing a past day's own figures for
      // those onto a different day would silently fabricate movements that
      // never happened on the day being seeded. A file's Remaining Stock
      // (or an Opening Stock column of its own) is the one figure that's
      // legitimately "existing data" to carry over.
      const importedColumns = columns.filter((c) => c.key === "openingStock");
      const columnIndexes = matchColumnIndexes(importedColumns, header);
      // Whether Opening Stock itself wasn't found in this file at all -
      // worth a heads-up, since every row will otherwise just look
      // "unchanged" with no indication why (see the toast message below).
      const missingColumns = unmatchedColumns(importedColumns, header);

      const matchedRows: MatchedImportRow[] = [];
      const unmatchedRows: UnmatchedImportRow[] = [];
      let unchanged = 0;
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
      const importLines = table.slice(headerRowIdx + 1);
      for (const [rawLineIndex, line] of importLines.entries()) {
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
        // See findMatchingProduct's own doc comment (utils/importMatch.ts)
        // for why this normalizes both sides and matches on category too,
        // when known.
        const match = findMatchingProduct(rows, productName, category);
        if (!match) {
          unmatchedRows.push({ productName, category, rawLineIndex });
          continue;
        }

        // Only include values that actually differ from what's already on
        // the grid. A round-tripped export (open in Excel, tweak one cell,
        // re-import) otherwise resubmits every unchanged "0" as a real edit -
        // 60+ redundant writes (and change-log entries) for what's really a
        // one-cell correction.
        const changes: Record<string, number> = {};
        for (const { key, idx } of columnIndexes) {
          const raw = line[idx];
          if (raw === undefined || raw.trim() === "") continue;
          const parsed = Number(raw);
          if (Number.isNaN(parsed)) continue;
          const current = Number(match.entry[key] ?? 0);
          if (parsed !== current) changes[key] = parsed;
        }
        if (Object.keys(changes).length === 0) {
          unchanged++;
          continue;
        }

        matchedRows.push({
          productId: match.product.id,
          productName: match.product.name,
          category: match.product.category,
          changes,
          warning: validateImport?.(match.product.id, changes),
        });
      }

      // Everything past this point (accepting a suggestion, Save) needs the
      // raw lines/column layout again to re-derive a diff - stashed here
      // rather than re-parsed, since the file itself isn't kept around.
      importContextRef.current = { lines: importLines, columnIndexes, unchangedCount: unchanged, fileName: file.name };
      setImportReview({ matchedRows, unmatchedRows, missingColumns: missingColumns.map((c) => c.label) });
    } catch (err) {
      setMessage(err instanceof Error ? `Import failed: ${err.message}` : "Import failed");
      setMessageVariant("error");
      setShowUndoImport(false);
    } finally {
      setBusy(false);
    }
  }

  /// Moves one unmatched row onto the matched list using the destination the
  /// user picked from its fuzzy suggestion - re-running the same "only
  /// include changed values" diff against THAT product's current row (not
  /// the one the file's own text implied), same as a normal match. A row
  /// that turns out identical to the suggested product's current values is
  /// still removed from the unmatched list (the user resolved it) but never
  /// added to matched - same "nothing to change" treatment as any other
  /// unchanged row.
  function acceptSuggestion(rawLineIndex: number, product: Product) {
    const context = importContextRef.current;
    const line = context?.lines[rawLineIndex];
    if (!context || !line) return;

    const currentRow = rows.find((r) => r.product.id === product.id);
    const changes: Record<string, number> = {};
    for (const { key, idx } of context.columnIndexes) {
      const raw = line[idx];
      if (raw === undefined || raw.trim() === "") continue;
      const parsed = Number(raw);
      if (Number.isNaN(parsed)) continue;
      const current = Number(currentRow?.entry[key] ?? 0);
      if (parsed !== current) changes[key] = parsed;
    }

    setImportReview((prev) => {
      if (!prev) return prev;
      const unmatchedRows = prev.unmatchedRows.filter((u) => u.rawLineIndex !== rawLineIndex);
      const matchedRows = Object.keys(changes).length
        ? [
            ...prev.matchedRows,
            {
              productId: product.id,
              productName: product.name,
              category: product.category,
              changes,
              warning: validateImport?.(product.id, changes),
            },
          ]
        : prev.matchedRows;
      return { ...prev, matchedRows, unmatchedRows };
    });
  }

  /// The Review modal's own Save - this is the point the old inline import
  /// actually mutated anything, so it's also where the network progress bar
  /// now starts/advances/finishes (see handleImportFile, which no longer
  /// touches it at all - parsing is purely local and instant). Also the
  /// point that captures lastImportBatch: the old value for each changed
  /// cell, resolved from `rows` the exact same way the review modal's own
  /// diff already does, since that's the only "what did this actually
  /// change from" this component ever has - a fresh recompute here, not a
  /// carry-over from MatchedImportRow (which only ever needed the new
  /// values) or the modal's own render (which never persists what it drew).
  async function handleConfirmImport() {
    if (!importReview || importReview.matchedRows.length === 0) return;
    setSavingImport(true);
    progress.start();
    try {
      const total = importReview.matchedRows.length;
      const batchEntries: ImportBatch["entries"] = {};
      for (let i = 0; i < importReview.matchedRows.length; i++) {
        const row = importReview.matchedRows[i];
        await onImportRow(row.productId, row.changes);

        const priorRow = rows.find((r) => r.product.id === row.productId);
        const fields: Record<string, { oldValue: number; newValue: number }> = {};
        for (const [key, newValue] of Object.entries(row.changes)) {
          fields[key] = { oldValue: Number(priorRow?.entry[key] ?? 0), newValue };
        }
        batchEntries[row.productId] = fields;

        progress.set(Math.round(((i + 1) / total) * 100));
      }

      setLastImportBatch({ fileName: importContextRef.current?.fileName ?? "import", importedAt: Date.now(), entries: batchEntries });
      setShowUndoImport(true);

      const updated = importReview.matchedRows.length;
      const unchanged = importContextRef.current?.unchangedCount ?? 0;
      const stillUnmatched = importReview.unmatchedRows.length;
      const parts = [`Imported ${updated} row${updated === 1 ? "" : "s"}`];
      if (unchanged) parts.push(`${unchanged} unchanged`);
      if (stillUnmatched) parts.push(`${stillUnmatched} still unmatched after review`);
      setMessage(`${parts.join(", ")}.`);
      // Worth reading in full, not glancing past - stays up until dismissed
      // rather than auto-clearing while there's something unresolved (rows
      // that still didn't match anything even after the review modal).
      setMessageVariant(stillUnmatched ? "error" : "info");
      progress.done();
      setImportReview(null);
    } catch (err) {
      setMessage(err instanceof Error ? `Import failed: ${err.message}` : "Import failed");
      setMessageVariant("error");
      setShowUndoImport(false);
      progress.fail();
    } finally {
      setSavingImport(false);
    }
  }

  /// One-shot "Undo Import" (see lastImportBatch's own doc comment) - only
  /// reverts a cell that's still exactly what this import last staged for
  /// it (checked via getPendingValue), so a manual edit - or a second
  /// import - made to that cell afterward is left alone rather than
  /// silently overwritten. Reuses onImportRow one cell at a time, same as
  /// the import itself used, so a revert is indistinguishable from staging
  /// that old value by hand.
  async function handleUndoImport() {
    if (undoInFlightRef.current) return;
    const batch = lastImportBatch;
    if (!batch) return;
    undoInFlightRef.current = true;
    setShowUndoImport(false);
    progress.start();
    try {
      const cells = Object.entries(batch.entries).flatMap(([productIdStr, fields]) =>
        Object.entries(fields).map(([key, values]) => ({ productId: Number(productIdStr), key, ...values })),
      );

      let reverted = 0;
      let skipped = 0;
      for (let i = 0; i < cells.length; i++) {
        const cell = cells[i];
        if (getPendingValue(cell.productId, cell.key) === cell.newValue) {
          await onImportRow(cell.productId, { [cell.key]: cell.oldValue });
          reverted++;
        } else {
          skipped++;
        }
        progress.set(Math.round(((i + 1) / cells.length) * 100));
      }

      setLastImportBatch(null);
      const parts = [`Reverted ${reverted} cell${reverted === 1 ? "" : "s"} from ${batch.fileName}`];
      if (skipped) parts.push(`${skipped} cell${skipped === 1 ? "" : "s"} skipped, already changed since`);
      setMessage(`${parts.join(", ")}.`);
      setMessageVariant(skipped ? "error" : "info");
      progress.done();
    } catch (err) {
      setMessage(err instanceof Error ? `Undo failed: ${err.message}` : "Undo failed");
      setMessageVariant("error");
      progress.fail();
    } finally {
      undoInFlightRef.current = false;
    }
  }

  return (
    <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
      {/* `layout` on the group and every segment button - compact mode
          (index.css's .ae-toolbar--compact rules) turns this from one
          joined pill with text labels into individually circular icon
          buttons purely via a CSS class swap, which otherwise pops
          instantly. `layout` makes that whole reshape (background,
          border-radius, each button's own width) animate smoothly via
          Framer's FLIP projection instead. */}
      <motion.div
        layout
        transition={toolbarLayoutTransition}
        className="ae-segment-group"
        aria-label="Export/Import"
        title="Export/Import"
      >
        {showExport && (
          <>
            <motion.button
              layout
              transition={toolbarLayoutTransition}
              whileTap={{ scale: 0.94 }}
              type="button"
              className="ae-segment-btn"
              onClick={handleExport}
              disabled={disabled}
              title={asExcel ? "Export as Excel (.xls)" : "Export"}
            >
              <UploadIcon />
              <span className="ae-segment-label">{asExcel ? "Export Excel" : "Export"}</span>
            </motion.button>
            {showPdf && <div className="ae-segment-divider" />}
          </>
        )}
        {showPdf && (
          <motion.button
            layout
            transition={toolbarLayoutTransition}
            whileTap={{ scale: 0.94 }}
            type="button"
            className="ae-segment-btn"
            onClick={() => void handlePdf()}
            disabled={disabled || pdfDisabled}
            title={pdfDisabled ? "Save your changes first - PDF reflects only saved data" : "Download as PDF"}
          >
            <PrinterIcon />
            <span className="ae-segment-label">PDF</span>
          </motion.button>
        )}
        {canImport && (
          <>
            {(showExport || showPdf) && <div className="ae-segment-divider" />}
            <motion.button
              layout
              transition={toolbarLayoutTransition}
              whileTap={{ scale: 0.94 }}
              type="button"
              className="ae-segment-btn"
              onClick={() => fileInputRef.current?.click()}
              disabled={disabled || busy}
              title={busy ? "Importing…" : "Import"}
            >
              <DownloadIcon />
              <span className="ae-segment-label">{busy ? "Importing…" : "Import"}</span>
            </motion.button>
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
      </motion.div>
      <Toast
        message={message}
        onDismiss={() => {
          setMessage(null);
          setShowUndoImport(false);
        }}
        variant={messageVariant}
        duration={messageVariant === "error" ? null : 6000}
        action={showUndoImport && lastImportBatch ? { label: "Undo Import", onClick: () => void handleUndoImport() } : undefined}
      />
      {importReview && (
        <Modal title="Review Import" onClose={() => setImportReview(null)} width={760}>
          <PendingChangesPreview
            items={importReview.matchedRows.flatMap((row): PendingChangeDetail[] =>
              Object.entries(row.changes).map(([key, newValue]) => ({
                productId: row.productId,
                name: row.productName,
                category: row.category,
                label: columns.find((c) => c.key === key)?.label ?? key,
                // Resolved the same way describePendingChanges resolves an
                // old value - against the last-saved `rows`, never the
                // (already-changed) values sitting in this review.
                oldValue: Number(rows.find((r) => r.product.id === row.productId)?.entry[key] ?? 0),
                newValue,
              })),
            )}
          />
          {importReview.matchedRows.some((r) => r.warning) && (
            <div style={{ marginTop: 14 }}>
              <h4 style={{ margin: "0 0 6px", fontSize: 13, color: colors.danger }}>
                ⚠ May fail to save
              </h4>
              {/* Advisory only (see validateImport's own doc comment) -
                  these rows are still staged and still counted in
                  "Save (N)" below; this is a heads-up before Save is
                  clicked, not a second gate. */}
              <ul style={{ margin: 0, padding: "0 0 0 18px", fontSize: 12.5, color: colors.subtleInk }}>
                {importReview.matchedRows
                  .filter((r) => r.warning)
                  .map((r) => (
                    <li key={r.productId}>
                      <strong style={{ color: colors.ink }}>{r.productName}</strong>: {r.warning}
                    </li>
                  ))}
              </ul>
            </div>
          )}
          {importReview.missingColumns.length > 0 && (
            <p style={{ margin: "12px 0 0", fontSize: 12.5, color: colors.subtleInk }}>
              Not found in this file, left unchanged: {importReview.missingColumns.join(", ")}.
            </p>
          )}
          {importReview.unmatchedRows.length > 0 && (
            <div style={{ marginTop: 18 }}>
              <h4 style={{ margin: "0 0 6px", fontSize: 13, color: colors.ink }}>
                Unmatched ({importReview.unmatchedRows.length})
              </h4>
              <div className="table-scroll" style={{ maxHeight: 240, overflowY: "auto" }}>
                {importReview.unmatchedRows.map((row) => (
                  <UnmatchedImportRowView
                    key={row.rawLineIndex}
                    row={row}
                    candidates={rows.map((r) => r.product)}
                    onAccept={acceptSuggestion}
                  />
                ))}
              </div>
            </div>
          )}
          <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 16 }}>
            <Button type="button" variant="secondary" size="sm" onClick={() => setImportReview(null)}>
              Cancel
            </Button>
            <Button
              type="button"
              size="sm"
              onClick={() => void handleConfirmImport()}
              disabled={importReview.matchedRows.length === 0 || savingImport}
            >
              {savingImport ? "Saving…" : `Save (${importReview.matchedRows.length})`}
            </Button>
          </div>
        </Modal>
      )}
    </div>
  );
});