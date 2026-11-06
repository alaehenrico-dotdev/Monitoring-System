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

/// A server that predates the RTS and Backloads figures does not send them at all (the field is
/// missing, not null). The page would format that as "NaN", so a missing figure is read as "nothing
/// recorded" - the same as null - and every consumer can rely on number | null. This matters during a
/// deploy, when the browser can be running newer code than the server it talks to.
export function normalizeDailyOutEntry(e: Partial<DailyOutEntry> & { date: string }): DailyOutEntry {
  return {
    date: e.date,
    onlineOut: e.onlineOut ?? null,
    onlineRts: e.onlineRts ?? null,
    offlineOut: e.offlineOut ?? null,
    offlineBackloads: e.offlineBackloads ?? null,
    totalOut: e.totalOut ?? null,
  };
}

/// Every date from `from` to `to` inclusive, in order.
export async function getDailyOut(from: string, to: string): Promise<DailyOutEntry[]> {
  const rows = await http.get<(Partial<DailyOutEntry> & { date: string })[]>(`/total-stocks/daily-out?from=${from}&to=${to}`);
  return rows.map(normalizeDailyOutEntry);
}
