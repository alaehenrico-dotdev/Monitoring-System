import { http } from "./http";

/// "Audit Report" is the Manual Counting & Variance (Audit) page's PDF.
export type ReportHistoryType =
  | "Daily Report"
  | "Variance Report"
  | "Audit Report";

export interface ReportHistoryEntry {
  id: number;
  type: ReportHistoryType;
  scope: string;
  route: string;
  generatedAt: string;
  /// Which part was generated; null on entries from before it was recorded.
  section?: "online" | "offline" | "all" | null;
  generatedBy: { id: number; name: string; username: string } | null;
}

/// Server-backed Report History (replaces the old localStorage utility of the
/// same name) - best effort by design: a failed write here should never
/// block the report the user just generated, so every call site wraps this
/// in its own `.catch()` rather than awaiting it inline.
export function recordReportHistory(data: {
  type: ReportHistoryType;
  scope: string;
  route: string;
  /// Which part was generated, for reports that have an Online/Offline split.
  section?: "online" | "offline" | "all";
}) {
  return http.post<ReportHistoryEntry>("/report-history", data);
}

export function listReportHistory(type: ReportHistoryType) {
  return http.get<ReportHistoryEntry[]>(
    `/report-history?type=${encodeURIComponent(type)}`,
  );
}
