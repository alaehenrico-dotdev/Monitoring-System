import { http } from "./http";
import type { Shift } from "../types";

/* ---------------------------------------------------------------- queue */

export interface QueueItem {
  id: string;
  kind: "variance" | "low-stock" | "missing-entry" | "backup" | "correction";
  severity: "high" | "medium" | "low";
  title: string;
  detail: string;
  /// In-app route that opens the record needing attention.
  link: string;
}

export interface ActionQueue {
  generatedAt: string;
  total: number;
  counts: { variance: number; lowStock: number; missingEntries: number; backup: number; corrections: number };
  items: QueueItem[];
}

export const getActionQueue = () => http.get<ActionQueue>("/action-queue");

/* -------------------------------------------------------- day closures */

export interface DayClosure {
  id: number;
  entryDate: string;
  shift: Shift;
  isClosed: boolean;
  closedAt: string;
  closedBy: { id: number; name: string } | null;
  unlockedAt: string | null;
  unlockedBy: { id: number; name: string } | null;
  unlockReason: string | null;
  /// True for an encoder's Finish day: entries are frozen, Manual Counts are not.
  entriesOnly?: boolean;
}

export interface CloseReadiness {
  ready: boolean;
  problems: string[];
}

export const listDayClosures = (from?: string, to?: string) => {
  const params = new URLSearchParams();
  if (from) params.set("from", from);
  if (to) params.set("to", to);
  return http.get<DayClosure[]>(`/day-closures?${params}`);
};
export const getCloseReadiness = (date: string, shift: Shift) =>
  http.get<CloseReadiness>(`/day-closures/readiness?date=${date}&shift=${shift}`);
export interface DayStatus {
  entryDate: string;
  shift: Shift;
  isClosed: boolean;
  closure: DayClosure | null;
  /// An earlier day with saved entries that is not finished yet: it has to be
  /// finished before this one can be entered. Null when nothing blocks.
  blockedBy: { entryDate: string; shift: Shift } | null;
}

export interface FinishSummary {
  online: { saved: number; total: number };
  offline: { saved: number; total: number };
  alreadyFinished: boolean;
}

/// Open to every role - an encoder has to know a sheet is locked before typing.
export const getDayStatus = (date: string, shift: Shift) =>
  http.get<DayStatus>(`/day-closures/status?date=${date}&shift=${shift}`);
export const getFinishSummary = (date: string, shift: Shift) =>
  http.get<FinishSummary>(`/day-closures/finish-summary?date=${date}&shift=${shift}`);
/// The encoder's Finish day: locks the entry grids and saves the Daily Report snapshot.
export const finishDay = (date: string, shift: Shift) =>
  http.post<FinishSummary & { finished: boolean }>("/day-closures/finish", { date, shift });
export const closeDay = (date: string, shift: Shift) => http.post<DayClosure>("/day-closures/close", { date, shift });
export const unlockDay = (date: string, shift: Shift, reason: string) =>
  http.post<DayClosure>("/day-closures/unlock", { date, shift, reason });

/* ---------------------------------------------------------- corrections */

export type CorrectionStatus = "PENDING" | "APPROVED" | "REJECTED";
export type CorrectionTable = "daily_online_stock" | "daily_offline_stock" | "manual_counts";

export interface Correction {
  id: number;
  tableName: CorrectionTable;
  recordId: number;
  field: string;
  beforeValue: string;
  proposedValue: string;
  appliedBefore: string | null;
  reason: string;
  status: CorrectionStatus;
  requestedAt: string;
  requestedBy: { id: number; name: string } | null;
  reviewedAt: string | null;
  reviewedBy: { id: number; name: string } | null;
  reviewNote: string | null;
  events: { id: number; event: string; at: string; note: string | null; by: { id: number; name: string } | null }[];
}

export const requestCorrection = (data: {
  tableName: CorrectionTable;
  recordId: number;
  field: string;
  proposedValue: number;
  reason: string;
}) => http.post<Correction>("/corrections", data);

export const listCorrections = (status: CorrectionStatus | undefined, offset: number, limit: number) => {
  const params = new URLSearchParams({ offset: String(offset), limit: String(limit) });
  if (status) params.set("status", status);
  return http.get<{ items: Correction[]; total: number }>(`/corrections?${params}`);
};
export const approveCorrection = (id: number, note?: string) => http.post<Correction>(`/corrections/${id}/approve`, { note });
export const rejectCorrection = (id: number, note: string) => http.post<Correction>(`/corrections/${id}/reject`, { note });

/* -------------------------------------------------------- client errors */

export interface ClientErrorRow {
  id: number;
  page: string;
  message: string;
  stack: string | null;
  source: string;
  appVersion: string | null;
  userAgent: string | null;
  createdAt: string;
  user: { id: number; name: string; username: string } | null;
}

export const listClientErrors = (offset: number, limit: number) =>
  http.get<{ items: ClientErrorRow[]; total: number }>(`/client-errors?offset=${offset}&limit=${limit}`);

/* ------------------------------------------------------ change-log archive */

export interface ArchiveRow {
  id: number;
  tableName: string;
  recordId: number;
  action: "CREATE" | "UPDATE" | "DELETE";
  changedById: number | null;
  changedAt: string;
  archivedAt: string;
}

export const listChangeLogArchive = (offset: number, limit: number) =>
  http.get<{ items: ArchiveRow[]; total: number; retentionMonths: number }>(
    `/change-log/archive?offset=${offset}&limit=${limit}`,
  );
export const runChangeLogArchive = (months?: number) =>
  http.post<{ moved: number; cutoff: string }>("/change-log/archive/run", months ? { months } : {});
