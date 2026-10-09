import type { ImportBatchSummary } from "../api/importBatches";
import { toCsv } from "./csv";

const SHIFT_LABEL = { MORNING: "Morning", NIGHT: "Night" } as const;

const HEADERS = ["File", "Entry date", "Shift", "Location", "Rows", "Imported by", "Imported at"];

/// The Import History list as CSV text, one line per import, newest first as
/// the API returns them. Dates are written as ISO values so they sort and
/// parse in a spreadsheet; a text cell starting with = + - @ is prefixed with
/// an apostrophe so a hostile file name can't run as a formula.
export function importHistoryCsv(batches: ImportBatchSummary[]): string {
  const safe = (v: string) => (/^[=+\-@]/.test(v) ? `'${v}` : v);
  return toCsv(
    HEADERS,
    batches.map((b) => [
      safe(b.fileName),
      b.entryDate.slice(0, 10),
      SHIFT_LABEL[b.shift] ?? b.shift,
      b.location,
      b.rowCount,
      safe(b.importedBy?.name ?? ""),
      b.importedAt,
    ]),
  );
}
