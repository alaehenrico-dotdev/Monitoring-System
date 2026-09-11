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

/// Section 4.3 - Remaining Stocks = Offline Stocks + Production (In) - Delivery (Out) + Backloads.
export function calculateOfflineRemaining(offlineStock: number, productionIn: number, deliveryOut: number, backloads: number): number {
  return offlineStock + productionIn - deliveryOut + backloads;
}

/// Section 4.4 - Variance = System Remaining Stock - Manual Count.
export function calculateVariance(systemRemainingStock: number, manualCount: number): number {
  return systemRemainingStock - manualCount;
}
