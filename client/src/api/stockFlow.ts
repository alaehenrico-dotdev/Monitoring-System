import { http } from "./http";

/// One calendar day of stock movement. A null figure means nothing was
/// recorded that side that day - not zero.
export interface StockFlowEntry {
  date: string; // YYYY-MM-DD
  /// Production In, Online + Offline.
  production: number | null;
  /// Online fulfillment out.
  fulfillment: number | null;
  /// Offline delivery out.
  delivery: number | null;
}

/// Every date from `from` to `to` inclusive, in order.
export function getStockFlow(from: string, to: string) {
  return http.get<StockFlowEntry[]>(`/total-stocks/stock-flow?from=${from}&to=${to}`);
}
