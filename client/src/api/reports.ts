import { http } from "./http";
import type { OfflineGridRow, OnlineGridRow, TotalStockRow } from "../types";

/// One audit (manual count) line of the Daily Report.
export interface AuditReportRow {
  product: { category: string; sku: string | null; name: string };
  shift: "MORNING" | "NIGHT";
  location: "ONLINE" | "OFFLINE" | "TOTAL";
  systemRemainingStock: number;
  manualCount: number;
  variance: number;
  remarks: string | null;
  /// Approved by a supervisor (the Audit page's Publish).
  published: boolean;
  /// The first count of a product at a location seeds the system, so it has no variance.
  isOpeningBalance: boolean;
}

export interface DailyReport {
  date: string;
  online: OnlineGridRow[];
  offline: OfflineGridRow[];
  total: TotalStockRow[];
  /// Every audit count saved for the date (absent on very old frozen reports).
  audit?: AuditReportRow[];
  /// Set when this is the frozen copy saved at Finish day rather than live figures.
  snapshot?: { savedAt: string; savedBy: { id: number; name: string } | null } | null;
}

export function getDailyReport(date: string) {
  return http.get<DailyReport>(`/reports/daily?date=${date}`);
}
