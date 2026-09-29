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
