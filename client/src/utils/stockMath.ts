/**
 * Client-side mirror of server/src/utils/stockMath.ts - the same pure
 * formulas, kept in sync by hand. Used ONLY for the CSV Review modal's
 * advisory "would this fail server-side" pre-check (CsvTools.tsx via
 * OnlineEntryPage/OfflineEntryPage's validateImport) - the server remains
 * the sole real enforcement point. If these two files drift apart, the
 * pre-check just gets less accurate (a false "looks fine" or a false
 * warning); it can never let something through that the server wouldn't
 * still correctly reject, since Save always goes through the real endpoint
 * regardless of what this predicts.
 */

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
/// (Out). See server/src/utils/stockMath.test.ts's pinned real-report
/// example (3554+804-752+29=3635) for why the sign matters.
export function calculateOfflineRemaining(
  offlineStock: number,
  productionIn: number,
  deliveryOut: number,
  backloads: number,
  upsellOut: number,
): number {
  return offlineStock + productionIn - deliveryOut - upsellOut + backloads;
}

/// Same guard as the server's - a channel's own Remaining Stock can't be
/// negative (it becomes next shift's Opening Stock). Advisory here, not
/// enforced: only the server's own check actually blocks a save.
export function isNegativeStock(remainingStock: number): boolean {
  return remainingStock < 0;
}
