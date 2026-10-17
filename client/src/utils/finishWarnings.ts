import { hasNegativeValue } from "../hooks/useGridView";
import type { GridRow } from "../components/StockGrid";

/// What the Finish confirmation should warn about on the sheet being locked:
/// products whose figures end below zero (never a real stock reading, and about
/// to be frozen). A warning only - the server does not block finishing a day for
/// it - so the person finishing sees it and decides.
export function belowZeroWarnings(rows: GridRow[] | null): string[] {
  const n = (rows ?? []).filter(hasNegativeValue).length;
  if (n === 0) return [];
  return [`${n} product${n === 1 ? "" : "s"} ${n === 1 ? "ends" : "end"} below zero stock on this sheet.`];
}
