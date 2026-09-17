import { http } from "./http";
import type { OfflineGridRow, OnlineGridRow, TotalStockRow } from "../types";

export interface DailyReport {
  date: string;
  online: OnlineGridRow[];
  offline: OfflineGridRow[];
  total: TotalStockRow[];
}

export function getDailyReport(date: string) {
  return http.get<DailyReport>(`/reports/daily?date=${date}`);
}
