import { http } from "./http";
import type { OfflineGridRow, OnlineGridRow, TotalStockRow } from "../types";

export interface DailyReport {
  date: string;
  online: OnlineGridRow[];
  offline: OfflineGridRow[];
  total: TotalStockRow[];
  /// Set when this is the frozen copy saved at Finish day rather than live figures.
  snapshot?: { savedAt: string; savedBy: { id: number; name: string } | null } | null;
}

export function getDailyReport(date: string) {
  return http.get<DailyReport>(`/reports/daily?date=${date}`);
}
