import { API_URL, ApiError, getToken, http } from "./http";
import type { ChangeLogEntry } from "../types";

export interface ChangeLogFilters {
  tableName?: string;
  recordId?: number;
  /// ISO timestamps (the page sends local start/end of day).
  dateFrom?: string;
  dateTo?: string;
  userId?: number;
  action?: ChangeLogEntry["action"];
  productId?: number;
  shift?: "MORNING" | "NIGHT";
  importOnly?: boolean;
  /// Only for tableName "reports".
  reportType?: "Daily Report" | "Variance Report" | "Audit Report";
  reportSection?: "online" | "offline" | "all";
}

export interface ChangeLogPage {
  items: ChangeLogEntry[];
  /// Pass back as `cursor` for the next (older) page; null on the last one.
  nextCursor: number | null;
}

function filterParams(filters: ChangeLogFilters): URLSearchParams {
  const params = new URLSearchParams();
  if (filters.tableName) params.set("tableName", filters.tableName);
  if (filters.recordId) params.set("recordId", String(filters.recordId));
  if (filters.dateFrom) params.set("dateFrom", filters.dateFrom);
  if (filters.dateTo) params.set("dateTo", filters.dateTo);
  if (filters.userId) params.set("userId", String(filters.userId));
  if (filters.action) params.set("action", filters.action);
  if (filters.productId) params.set("productId", String(filters.productId));
  if (filters.shift) params.set("shift", filters.shift);
  if (filters.importOnly) params.set("importOnly", "true");
  if (filters.reportType) params.set("reportType", filters.reportType);
  if (filters.reportSection) params.set("reportSection", filters.reportSection);
  return params;
}

/// One newest-first page of the log.
export function listChangeLogPage(filters: ChangeLogFilters = {}, page: { limit?: number; cursor?: number } = {}) {
  const params = filterParams(filters);
  if (page.limit) params.set("limit", String(page.limit));
  if (page.cursor) params.set("cursor", String(page.cursor));
  const qs = params.toString();
  return http.get<ChangeLogPage>(`/change-log${qs ? `?${qs}` : ""}`);
}

/// The first page's rows only - for callers that just want the latest few
/// (the Dashboard's recent-activity feed).
export function listChangeLog(filters: ChangeLogFilters = {}) {
  return listChangeLogPage(filters).then((page) => page.items);
}

/// The filtered list as a CSV Blob. Goes around `http` because that helper
/// parses JSON and has a 4s timeout, neither of which suits a file download.
export async function exportChangeLogCsv(filters: ChangeLogFilters = {}): Promise<Blob> {
  const token = getToken();
  const qs = filterParams(filters).toString();
  const response = await fetch(`${API_URL}/change-log/export${qs ? `?${qs}` : ""}`, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });
  if (!response.ok) {
    const body = await response.json().catch(() => ({ error: response.statusText }));
    throw new ApiError(response.status, body.error ?? "Export failed");
  }
  return response.blob();
}

/// Accounts for the "user" filter (Supervisor/Admin only, like the log itself).
export function listChangeLogUsers() {
  return http.get<{ id: number; name: string; username: string }[]>("/users");
}

/// One cell's edit history (product+date+shift row, one column), newest
/// first. Unlike listChangeLog above this is open to every role that can
/// open the grid, and the server returns only the requested field's values -
/// never a whole row snapshot. See server changeLog.service.getCellHistory.
export interface CellHistoryEntry {
  changedAt: string;
  who: string | null;
  oldValue: number | null;
  newValue: number;
}

export function getCellHistory(params: {
  tableName: string;
  recordId: number;
  field: string;
  limit?: number;
}) {
  const qs = new URLSearchParams({
    tableName: params.tableName,
    recordId: String(params.recordId),
    field: params.field,
  });
  if (params.limit) qs.set("limit", String(params.limit));
  return http.get<CellHistoryEntry[]>(`/change-log/cell?${qs}`);
}
