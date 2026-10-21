import { http } from "./http";

/// One calendar day of stock leaving the company (see the server's
/// dailyOutflow.service). A null side means nothing was recorded that day -
/// not zero.
export interface DailyOutEntry {
  date: string; // YYYY-MM-DD
  onlineOut: number | null;
  offlineOut: number | null;
  totalOut: number | null;
}

/// Every date from `from` to `to` inclusive, in order.
export function getDailyOut(from: string, to: string) {
  return http.get<DailyOutEntry[]>(`/total-stocks/daily-out?from=${from}&to=${to}`);
}
