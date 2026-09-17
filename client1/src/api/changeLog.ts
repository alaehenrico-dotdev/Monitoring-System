import { http } from "./http";
import type { ChangeLogEntry } from "../types";

export function listChangeLog(filters: { tableName?: string; recordId?: number } = {}) {
  const params = new URLSearchParams();
  if (filters.tableName) params.set("tableName", filters.tableName);
  if (filters.recordId) params.set("recordId", String(filters.recordId));
  const qs = params.toString();
  return http.get<ChangeLogEntry[]>(`/change-log${qs ? `?${qs}` : ""}`);
}
