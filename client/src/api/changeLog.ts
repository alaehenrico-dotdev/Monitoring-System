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
  reportType?: "Daily Report" | "Variance Report" | "Audit Report" | "Daily Out";
  reportSection?: "online" | "offline" | "all";
}

export interface ChangeLogPage {
  items: ChangeLogEntry[];
  /// Pass back as `cursor` for the next (older) page; null on the last one.
  nextCursor: number | null;
  /// Rows matching the filters in all - only when asked for (`withTotal`).
  total?: number;
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
export function listChangeLogPage(
  filters: ChangeLogFilters = {},
  page: { limit?: number; cursor?: number; offset?: number; withTotal?: boolean } = {},
) {
  const params = filterParams(filters);
  if (page.limit) params.set("limit", String(page.limit));
  if (page.cursor) params.set("cursor", String(page.cursor));
  if (page.offset) params.set("offset", String(page.offset));
  if (page.withTotal) params.set("withTotal", "true");
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

/// Per record id, the fields user saves changed that are still news (no time
/// limit: until the sheet is finished or the count published, and again after an
/// unlock) - drives the gold glow, including when browsing past dates.
export function getRecentCells(tableName: string, recordIds: number[]) {
  const qs = new URLSearchParams({ tableName, recordIds: recordIds.join(",") });
  return http.get<Record<number, string[]>>(`/change-log/recent-cells?${qs}`);
}

export type SheetKind = "online" | "offline" | "manual";

export interface SheetVersion {
  /// Pass as `upTo` to see the sheet as it stood when this version ended.
  upTo: number;
  /// Pass as `after` to highlight what this version changed.
  after: number;
  startedAt: string;
  endedAt: string;
  user: { id: number; name: string } | null;
  changes: number;
  products: number;
}

export interface SheetVersionRows {
  upTo: number;
  after: number;
  rows: {
    recordId: number;
    productId: number | null;
    sku: string | null;
    name: string | null;
    values: Record<string, string | number | boolean | null>;
    changed: string[];
  }[];
}

export interface PublishEvent {
  publishedAt: string;
  upTo: number;
  user: { id: number; name: string } | null;
  counts: number;
  appliedToOpening: boolean;
}

/// Version history of one sheet and shift (Supervisor/Admin only).
export function getSheetVersions(sheet: SheetKind, date: string, shift: "MORNING" | "NIGHT") {
  return http.get<{ versions: SheetVersion[] }>(`/change-log/sheet/versions?sheet=${sheet}&date=${date}&shift=${shift}`);
}

/// The sheet as it stood at change `upTo`, flagging cells that differ from `after`.
export function getSheetVersion(sheet: SheetKind, date: string, shift: "MORNING" | "NIGHT", upTo: number, after = 0) {
  return http.get<SheetVersionRows>(`/change-log/sheet/version?sheet=${sheet}&date=${date}&shift=${shift}&upTo=${upTo}&after=${after}`);
}

/// Each publish of a Manual Count sheet.
export function getSheetPublishes(date: string, shift: "MORNING" | "NIGHT") {
  return http.get<{ publishes: PublishEvent[] }>(`/change-log/sheet/publishes?date=${date}&shift=${shift}`);
}

/// Applies a version: writes that version's figures back through the normal entry
/// save (Online/Offline sheets only; Supervisor/Admin).
export function restoreSheetVersion(sheet: "online" | "offline", date: string, shift: "MORNING" | "NIGHT", upTo: number) {
  return http.post<{ restored: number; held: number; skipped: number }>("/change-log/sheet/restore", { sheet, date, shift, upTo });
}
