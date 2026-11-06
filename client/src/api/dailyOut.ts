import { http } from "./http";

/// One calendar day of stock leaving the company (see the server's
/// dailyOutflow.service). A null side means nothing was recorded that day -
/// not zero.
export interface DailyOutEntry {
  date: string; // YYYY-MM-DD
  onlineOut: number | null;
  /// Online RTS - shown beside onlineOut for information; it is not netted off it.
  onlineRts: number | null;
  /// Offline Delivery (Out) less Backloads (upsell is not part of it).
  offlineOut: number | null;
  /// The day's Backloads, already netted into offlineOut.
  offlineBackloads: number | null;
  totalOut: number | null;
}

/// Every date from `from` to `to` inclusive, in order.
export function getDailyOut(from: string, to: string) {
  return http.get<DailyOutEntry[]>(`/total-stocks/daily-out?from=${from}&to=${to}`);
}
