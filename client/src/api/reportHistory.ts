import { http } from "./http";

export interface ReportHistoryEntry {
  id: number;
  type: "Daily Report" | "Variance Report";
  scope: string;
  route: string;
  generatedAt: string;
  generatedBy: { id: number; name: string; username: string } | null;
}

/// Server-backed Report History (replaces the old localStorage utility of the
/// same name) - best effort by design: a failed write here should never
/// block the report the user just generated, so every call site wraps this
/// in its own `.catch()` rather than awaiting it inline.
export function recordReportHistory(data: { type: "Daily Report" | "Variance Report"; scope: string; route: string }) {
  return http.post<ReportHistoryEntry>("/report-history", data);
}

export function listReportHistory(type: "Daily Report" | "Variance Report") {
  return http.get<ReportHistoryEntry[]>(`/report-history?type=${encodeURIComponent(type)}`);
}
