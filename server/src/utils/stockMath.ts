/**
 * Pure stock-calculation formulas shared by the Online, Offline, Manual
 * Count, and Total Stocks services (Sections 4.2-4.5). No framework or
 * database imports here on purpose - these are plain functions any service
 * can call without creating a dependency between services.
 */

export function toNum(value: unknown): number {
  return value === null || value === undefined ? 0 : Number(value);
}

/// Every stock figure here is stored in a Decimal(14,2) column, but the
/// arithmetic itself runs in plain JS floats first - `0.7 + 0.1 - 0.8` is
/// `-1.1102230246251565e-16`, not exactly 0, purely from IEEE-754 binary
/// representation, not a real fractional cent. Rounding every calculated
/// figure to 2dp (matching the column) before it's returned - in particular
/// before isNegativeStock ever sees it - keeps that noise from being
/// mistaken for a real (if tiny) over-issue.
function round2(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

/// Section 4.4/4.6 - a manual count logged for a period supersedes that
/// period's own system-computed Remaining Stock as the opening balance the
/// next period carries forward (see dailyOnlineStockRepository/
/// dailyOfflineStockRepository's getOpeningStock for the full reasoning).
/// Nullish-coalescing, not `||` - a real manual count of exactly 0 is a
/// genuine physical count (nothing on hand) and must still win, not be
/// treated as "no count" and silently fall back to the system figure.
export function resolveOpeningStock(manualCount: unknown, systemRemainingStock: unknown): number {
  return toNum(manualCount ?? systemRemainingStock);
}

/// Orders periods on the timeline (Morning < Night within a date).
export function periodRank(entryDate: Date, shift: string): number {
  return entryDate.getTime() * 2 + (shift === "NIGHT" ? 1 : 0);
}

/// Section 4.2 - Online Stocks (subtotal) = opening + Stocks In - Stocks Out.
export function calculateOnlineStock(opening: number, stockIn: number, stockOut: number): number {
  return round2(opening + stockIn - stockOut);
}

/// Section 4.2 - Remaining Stocks = Online Stocks + Production (In) - Fulfillment (Out) + RTS.
export function calculateOnlineRemaining(onlineStock: number, productionIn: number, fulfillmentOut: number, rts: number): number {
  return round2(onlineStock + productionIn - fulfillmentOut + rts);
}

/// Section 4.3 - Offline Stocks (subtotal) = opening + Stocks In - Stocks Out.
export function calculateOfflineStock(opening: number, stockIn: number, stockOut: number): number {
  return round2(opening + stockIn - stockOut);
}

/// Section 4.3 - Remaining Stocks = Offline Stocks + Production (In) - Delivery
/// (Out) - Upsell (Out) + Backloads. Backloads ADDS onto Remaining Stock - a
/// backload is a delivery route returning undelivered stock, so it's a
/// return back into inventory, not an outflow like Delivery (Out)/Upsell
/// (Out).
export function calculateOfflineRemaining(
  offlineStock: number,
  productionIn: number,
  deliveryOut: number,
  backloads: number,
  upsellOut: number
): number {
  return round2(offlineStock + productionIn - deliveryOut - upsellOut + backloads);
}

/// Section 4.4 - Variance = System Remaining Stock - Manual Count.
export function calculateVariance(systemRemainingStock: number, manualCount: number): number {
  return round2(systemRemainingStock - manualCount);
}

/// Negative-stock guard - a channel's own Remaining Stock is the actual
/// current balance (it becomes next shift's Opening Stock), so a Stock Out
/// (Fulfillment/Delivery) or a transfer-out larger than what a channel
/// actually has on hand should be rejected by the service layer rather than
/// silently persisted as a negative balance. Deliberately just this
/// predicate, not the rejection itself (HttpError) - this file stays
/// framework/DB-free by design (see the header comment above); the
/// services decide what to do when this is true.
export function isNegativeStock(remainingStock: number): boolean {
  return remainingStock < 0;
}
