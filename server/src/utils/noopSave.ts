import { toNum } from "./stockMath";

/// True when a save would write exactly what the row already holds: same
/// opening stock, same figure in every column, and no added-column amounts
/// being replaced. Such a save (a double click, a retry after a dropped
/// response) is acknowledged without a write or a change-log row, so history
/// only records real changes.
export function isNoopSave(
  existing: object | null | undefined,
  openingStock: number,
  merged: Record<string, number>,
  touchedExtraColumns: number,
): boolean {
  if (!existing || touchedExtraColumns > 0) return false;
  const row = existing as Record<string, unknown>;
  if (toNum(row.openingStock as never) !== openingStock) return false;
  return Object.entries(merged).every(([key, value]) => toNum(row[key] as never) === value);
}
