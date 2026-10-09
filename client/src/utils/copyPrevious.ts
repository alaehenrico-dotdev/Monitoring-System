import type { Shift } from "../types";
import type { GridColumn } from "../components/StockGrid";

export type CopySource = "previous-shift" | "previous-day";

export interface Period {
  date: string;
  shift: Shift;
}

function shiftDays(date: string, days: number): string {
  // Parsed as UTC (the "T00:00:00Z" suffix) rather than local: a bare
  // "2026-10-09" is already UTC midnight by spec while "2026-10-09 00:00"
  // would be local, and mixing the two is how a date arithmetic helper ends
  // up a day out for anyone east of Greenwich. Entry dates are plain
  // calendar dates with no time zone of their own.
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/**
 * The period "Copy previous" reads from.
 *
 * Previous *shift* walks the real operating timeline, which is what makes
 * Morning's predecessor last night's Night shift rather than a Night shift
 * on the same calendar date that hasn't happened yet (see utils/shift.ts on
 * why Night is filed under the date it started).
 *
 * Previous *day* holds the shift and steps the date back one, which is the
 * useful comparison for a product line that runs the same way every morning.
 */
export function previousPeriod(current: Period, source: CopySource): Period {
  if (source === "previous-day") {
    return { date: shiftDays(current.date, -1), shift: current.shift };
  }
  return current.shift === "NIGHT"
    ? { date: current.date, shift: "MORNING" }
    : { date: shiftDays(current.date, -1), shift: "NIGHT" };
}

export function describePeriod(period: Period): string {
  return `${period.date} ${period.shift === "NIGHT" ? "Night" : "Morning"}`;
}

/**
 * Columns "Copy previous" may offer.
 *
 * Only directly-editable movement columns: Opening Stock is carried forward
 * by the server (Section 4.6) and the Online/Offline/Remaining Stock columns
 * are calculated from the others, so copying either would either be
 * overwritten on save or quietly contradict the figures it was derived from.
 */
export function copyableColumns(columns: GridColumn[]): GridColumn[] {
  return columns.filter((c) => c.editable);
}

/**
 * Columns ticked when the popover first opens.
 *
 * Stock movements between the two pools and the out/delivery figures are
 * genuinely different every shift - copying them forward would be inventing
 * data. Production (In) and the inbound transfer are the ones that really do
 * repeat shift to shift for a steady product line, which is what makes this
 * a time-saver rather than a source of plausible-looking fiction.
 */
const DEFAULT_COPY_KEYS = ["stockInOffToOl", "stockInOlToOff", "productionIn"];

export function defaultCopyKeys(columns: GridColumn[]): string[] {
  return copyableColumns(columns)
    .filter((c) => DEFAULT_COPY_KEYS.includes(c.key))
    .map((c) => c.key);
}

export interface CopyRow {
  productId: number;
  entry: Record<string, unknown>;
}

export interface CopyEdit {
  productId: number;
  key: string;
  value: number;
}

export interface CopyPlan {
  edits: CopyEdit[];
  /// Cells left alone because the encoder had already edited them and
  /// "Overwrite my edits" was off - surfaced so the toast can say so rather
  /// than silently doing less than asked.
  protectedCells: number;
}

/**
 * Works out what "Copy previous" would stage.
 *
 * `pending` is the live staged-edit map: a cell the encoder has already
 * typed into is theirs, and a bulk copy must not quietly overwrite it unless
 * they ask. Saved values are compared too, so copying a figure that already
 * matches stages nothing at all rather than queueing a no-op write.
 */
export function planCopyPrevious(
  sourceRows: CopyRow[],
  targetRows: CopyRow[],
  keys: string[],
  pending: Record<number, Record<string, number>>,
  overwriteMyEdits: boolean,
  getSavedValue: (productId: number, key: string) => number | undefined,
): CopyPlan {
  const sourceByProduct = new Map(sourceRows.map((r) => [r.productId, r.entry]));
  const edits: CopyEdit[] = [];
  let protectedCells = 0;

  for (const target of targetRows) {
    const source = sourceByProduct.get(target.productId);
    // No source row means that product simply wasn't entered last period -
    // that is "nothing to copy", not "copy a zero over what's there".
    if (!source) continue;

    for (const key of keys) {
      const raw = source[key];
      if (raw === null || raw === undefined || raw === "") continue;
      const value = Number(raw);
      if (!Number.isFinite(value) || value < 0) continue;

      if (!overwriteMyEdits && pending[target.productId]?.[key] !== undefined) {
        protectedCells += 1;
        continue;
      }
      if ((getSavedValue(target.productId, key) ?? 0) === value) continue;

      edits.push({ productId: target.productId, key, value });
    }
  }

  return { edits, protectedCells };
}
