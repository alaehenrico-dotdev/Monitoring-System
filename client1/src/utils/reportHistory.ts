export type ReportHistoryEntry = {
  id: string;
  type: "Daily Report" | "Variance Report";
  scope: string;
  generatedAt: string;
  route: string;
};

const STORAGE_KEY = "ala-eh-report-history";

export function readReportHistory(): ReportHistoryEntry[] {
  try {
    const value: unknown = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "[]");
    return Array.isArray(value) ? (value as ReportHistoryEntry[]) : [];
  } catch {
    return [];
  }
}

export function recordReportHistory(entry: Omit<ReportHistoryEntry, "id" | "generatedAt">): void {
  try {
    const history = readReportHistory();
    const next: ReportHistoryEntry = {
      ...entry,
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      generatedAt: new Date().toISOString(),
    };
    localStorage.setItem(STORAGE_KEY, JSON.stringify([next, ...history].slice(0, 100)));
    window.dispatchEvent(new Event("report-history-changed"));
  } catch {
    // Report viewing still works when browser storage is unavailable.
  }
}
