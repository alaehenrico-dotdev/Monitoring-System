import { http } from "./http";
import type { ChangeLogEntry } from "../types";

export function listChangeLog(filters: { tableName?: string; recordId?: number } = {}) {
  const params = new URLSearchParams();
  if (filters.tableName) params.set("tableName", filters.tableName);
  if (filters.recordId) params.set("recordId", String(filters.recordId));
  const qs = params.toString();
  return http.get<ChangeLogEntry[]>(`/change-log${qs ? `?${qs}` : ""}`);
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
