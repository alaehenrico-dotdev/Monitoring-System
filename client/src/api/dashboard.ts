import { http } from "./http";

export interface MonthlyOverviewEntry {
  month: number; // 1-12
  onlineRemainingStock: number | null;
  offlineRemainingStock: number | null;
  totalRemainingStock: number | null;
  varianceFlags: number | null;
  snapshotDate: string | null;
}

/// Dashboard > Monthly Monitoring - one entry per calendar month of `year`.
export function getMonthlyOverview(year: number) {
  return http.get<MonthlyOverviewEntry[]>(`/dashboard/monthly-overview?year=${year}`);
}

export interface DaysOfStockRow {
  productId: number;
  name: string;
  sku: string | null;
  unit: string;
  category: string;
  totalRemainingStock: number;
  lowStockThreshold: number | null;
  needsRestock: boolean;
  /// Null when there isn't enough history to state a rate.
  averageDailyOutflow: number | null;
  /// Null renders as "n/a" - fewer than 3 days of data, or nothing going out.
  daysLeft: number | null;
  daysWithData: number;
}

/// Dashboard > "Needs restock" / "Lowest days left". Already sorted most
/// urgent first by the server, and cached there for a minute - the aggregate
/// scans a fortnight of both stock tables.
export function getDaysOfStock(date?: string) {
  return http.get<DaysOfStockRow[]>(
    `/dashboard/days-of-stock${date ? `?date=${date}` : ""}`,
  );
}
