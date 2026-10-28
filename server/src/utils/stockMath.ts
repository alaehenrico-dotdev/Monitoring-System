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
/// Offline stock leaving the company in a period: deliveries and upsells,
/// less backloads (undelivered stock a route brings back, which the Remaining
/// formula adds back in). Transfers to Online are NOT outflow - they only move
/// stock between the two pools. One definition for days-of-stock and Daily Out.
export function offlineNetOutflow(deliveryOut: number, upsellOut: number, backloads: number): number {
  return round2(deliveryOut + upsellOut - backloads);
}

export function calculateOfflineRemaining(
  offlineStock: number,
  productionIn: number,
  deliveryOut: number,
  backloads: number,
  upsellOut: number
): number {
  return round2(offlineStock + productionIn - deliveryOut - upsellOut + backloads);
}

/// Section 4.4 - Variance = Manual Count - System Remaining Stock.
export function calculateVariance(systemRemainingStock: number, manualCount: number): number {
  return round2(manualCount - systemRemainingStock);
}

/// True when a channel's Remaining Stock is below zero.
///
/// A negative balance is NOT rejected on save - that is deliberate, do not turn
/// it back into an error. Out figures are often entered before the matching In
/// (production handed in later), and refusing the save would leave the Out
/// unrecorded. Instead the row is stored as computed (e.g. -15), and the
/// consequences come later and elsewhere:
///  - the Admin Queue lists it (actionQueue.service.ts);
///  - Finish Day refuses to lock the sheet while any row ends below zero, unless a
///    supervisor/admin signs it off with a written reason (dayFinish.service.ts,
///    negativeStock.service.ts); "finish through a range" has no sign-off and
///    simply blocks (finishThrough.service.ts);
///  - the Save review dialog warns before the save (client utils/saveReview.ts);
///  - the negative figure carries into the next period's opening like any other.
/// Deliberately just this predicate - this file stays framework/DB-free (see the
/// header comment above); the services decide what to do when it is true.
export function isNegativeStock(remainingStock: number): boolean {
  return remainingStock < 0;
}
