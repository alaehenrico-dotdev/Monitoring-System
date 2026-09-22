/**
 * Pure stock-calculation formulas shared by the Online, Offline, Manual
 * Count, and Total Stocks services (Sections 4.2-4.5). No framework or
 * database imports here on purpose - these are plain functions any service
 * can call without creating a dependency between services.
 */

export function toNum(value: unknown): number {
  return value === null || value === undefined ? 0 : Number(value);
}

/// Section 4.2 - Online Stocks (subtotal) = opening + Stocks In - Stocks Out.
export function calculateOnlineStock(opening: number, stockIn: number, stockOut: number): number {
  return opening + stockIn - stockOut;
}

/// Section 4.2 - Remaining Stocks = Online Stocks + Production (In) - Fulfillment (Out) + RTS.
export function calculateOnlineRemaining(onlineStock: number, productionIn: number, fulfillmentOut: number, rts: number): number {
  return onlineStock + productionIn - fulfillmentOut + rts;
}

/// Section 4.3 - Offline Stocks (subtotal) = opening + Stocks In - Stocks Out.
export function calculateOfflineStock(opening: number, stockIn: number, stockOut: number): number {
  return opening + stockIn - stockOut;
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
  return offlineStock + productionIn - deliveryOut - upsellOut + backloads;
}

/// Section 4.4 - Variance = System Remaining Stock - Manual Count.
export function calculateVariance(systemRemainingStock: number, manualCount: number): number {
  return systemRemainingStock - manualCount;
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
