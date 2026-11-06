import type { TotalStockRow } from "../types";
import { sumRounded } from "./gridFormat";

export type Totals = {
  /// Online and Offline are separate stock pools (Section 2.1) - each gets
  /// its own card rather than a combined sum, since summing them implies a
  /// single pool that doesn't really exist.
  online: number;
  offline: number;
};

export type Delta = { diff: number };

/// Summed the way the Consolidated page's GRAND TOTAL row is (sumRounded: to the
/// database's 2 decimals), so the two always show the same number. A plain float sum
/// can leave noise such as 0.30000000000000004 or a tiny negative printed as "-0".
export function summarize(rows: TotalStockRow[]): Totals {
  return {
    online: sumRounded(rows.map((row) => Number(row.onlineRemainingStock || 0))),
    offline: sumRounded(rows.map((row) => Number(row.offlineRemainingStock || 0))),
  };
}

/// Change since the previous day (stock levels have no good/bad direction,
/// so it is shown neutrally). Rounded like the totals, so equal figures read
/// "No change" rather than a 1e-15 "▲ 0 vs prev day".
export function makeDelta(current: number, previous: number | undefined): Delta | undefined {
  if (previous === undefined) return undefined;
  return { diff: sumRounded([current, -previous]) };
}
