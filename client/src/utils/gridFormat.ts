/// Shared number rendering for the stock grids (StockGrid, TotalStocksTable).
///
/// A fresh shift opens with almost every cell at zero, so printing "0" in all
/// of them buries the handful of figures that actually carry information.
/// Zero is drawn as a dimmed en dash instead, which keeps the column aligned
/// while letting real values stand out. Null/undefined renders the same way:
/// to an encoder there is no useful difference between "nothing entered" and
/// "entered as nothing".
export const ZERO_DASH = "–";

export interface FormattedNumber {
  text: string;
  /// True when this rendered as the dash, so the caller can dim it.
  isZero: boolean;
}

export function formatGridNumber(value: unknown): FormattedNumber {
  if (value === null || value === undefined || value === "") {
    return { text: ZERO_DASH, isZero: true };
  }
  const n = Number(value);
  if (!Number.isFinite(n) || n === 0) return { text: ZERO_DASH, isZero: true };
  return { text: n.toLocaleString(), isZero: false };
}

/// One row's share of its column total, for the "% of total" column. A zero
/// total would make every row read "0.0%", which says nothing, so that
/// renders as the dash instead.
export function formatPercentOfTotal(value: number, total: number): string {
  if (!total || !Number.isFinite(total)) return ZERO_DASH;
  const pct = (value / total) * 100;
  if (!Number.isFinite(pct) || pct === 0) return ZERO_DASH;
  return `${pct.toFixed(1)}%`;
}

/// Rejects anything that isn't a non-negative number. Stock figures are
/// counts of physical product: negative is never a real reading, and the
/// server's own negative-stock guard would reject it on save anyway, so it
/// is caught at the keystroke instead of after a round trip.
export function isValidStockValue(raw: string): boolean {
  if (raw.trim() === "") return true; // empty is "clear the cell", committed as 0
  const n = Number(raw);
  return Number.isFinite(n) && n >= 0;
}

/// How far a staged value may move from its last-saved value before the grid
/// flags it as suspicious. Deliberately generous - this warns, never blocks,
/// and a real restock or a full day's fulfilment can legitimately be large.
/// A jump only counts when the saved figure was itself meaningful; going from
/// 0 to 500 on a fresh cell is ordinary first entry, not an anomaly.
const JUMP_FACTOR = 10;
const JUMP_FLOOR = 100;

export function isUnusualJump(nextValue: number, savedValue: number): boolean {
  if (!Number.isFinite(nextValue) || !Number.isFinite(savedValue)) return false;
  if (savedValue <= 0) return false;
  const delta = Math.abs(nextValue - savedValue);
  return delta >= JUMP_FLOOR && delta >= savedValue * JUMP_FACTOR;
}
