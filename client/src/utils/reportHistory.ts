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

/**
 * This list only ever records that a report was generated/opened, on this
 * browser - it isn't backend data, so a Data Reset (server/src/services/
 * dataReset.service.ts) can't touch it by wiping tables. Called on a
 * successful reset (DataResetPage.tsx) so old entries don't linger pointing
 * at what's now empty/zeroed data, contradicting the reset's "clean slate".
 */
export function clearReportHistory(): void {
  try {
    localStorage.removeItem(STORAGE_KEY);
    window.dispatchEvent(new Event("report-history-changed"));
  } catch {
    // Nothing to clean up if storage is unavailable in the first place.
  }
}
