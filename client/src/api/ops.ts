import { http } from "./http";
import type { Shift } from "../types";

/* ---------------------------------------------------------------- queue */

export interface QueueItem {
  id: string;
  kind: "variance" | "negative-open" | "low-stock" | "missing-entry" | "backup" | "correction" | "unlock-request";
  severity: "high" | "medium" | "low";
  title: string;
  detail: string;
  /// In-app route that opens the record needing attention.
  link: string;
}

export interface ActionQueue {
  generatedAt: string;
  total: number;
  counts: { variance: number; lowStock: number; missingEntries: number; backup: number; corrections: number; unlockRequests?: number };
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
  /// Each entry page is finished on its own; `isClosed` means both are.
  onlineLocked: boolean;
  offlineLocked: boolean;
}

/// The two entry pages that are finished independently.
export type EntryLocation = "ONLINE" | "OFFLINE";

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
  /// Whether the page asked about (`location`) is finished; with no location,
  /// whether both are.
  locked: boolean;
  onlineLocked: boolean;
  offlineLocked: boolean;
  closure: DayClosure | null;
  /// An earlier day with saved entries that is not finished yet: it has to be
  /// finished before THIS day can be finished (locks stay in order). Null when
  /// nothing blocks.
  blockedBy: { entryDate: string; shift: Shift } | null;
  /// The same, for ENTERING figures: equal to `blockedBy` unless an admin has
  /// turned off Settings > Entry Rules > "Finish days in order", when it is null
  /// and the sheet stays editable.
  entryBlockedBy?: { entryDate: string; shift: Shift } | null;
}

export interface FinishSummary {
  online: { saved: number; total: number };
  offline: { saved: number; total: number };
  onlineLocked: boolean;
  offlineLocked: boolean;
  /// For the page asked about.
  alreadyFinished: boolean;
  /// Products below zero on the page asked about. Finishing needs a supervisor's
  /// sign-off while there are any.
  negatives: { productId: number; name: string; remainingStock: number }[];
  /// Pre-finish checklist, present when a page was asked about: the first few
  /// active products with no saved entry, how many there are in all, and how
  /// many saved products have no manual count. None of these block finishing.
  missing?: { productId: number; name: string }[];
  missingCount?: number;
  uncounted?: number;
}

/// Open to every role - an encoder has to know a sheet is locked before typing.
export const getDayStatus = (date: string, shift: Shift, location?: EntryLocation) =>
  http.get<DayStatus>(`/day-closures/status?date=${date}&shift=${shift}${location ? `&location=${location}` : ""}`);
export const getFinishSummary = (date: string, shift: Shift, location?: EntryLocation) =>
  http.get<FinishSummary>(`/day-closures/finish-summary?date=${date}&shift=${shift}${location ? `&location=${location}` : ""}`);
/// The encoder's Finish day for their own entry page: locks that page only. The
/// Daily Report snapshot is saved once the other page is finished too.
/// `negativeReason` is a supervisor's sign-off for finishing with negative stock.
export const finishDay = (date: string, shift: Shift, location: EntryLocation, negativeReason?: string) =>
  http.post<FinishSummary & { finished: boolean; reportSaved?: boolean }>("/day-closures/finish", { date, shift, location, negativeReason });
/* ------------------------------------------------- finish through a date */

export interface FinishPlan {
  location: EntryLocation;
  throughDate: string;
  /// What would be locked, oldest first.
  periods: { entryDate: string; shift: Shift; saved: number }[];
  /// Problems that stop it - nothing can be finished until they are fixed.
  blockers: string[];
  /// Things to look at; the encoder has to acknowledge them to go on.
  warnings: string[];
  canFinish: boolean;
}

export interface FinishThroughResult {
  finished: number;
  periods: string[];
  warnings: string[];
  /// Dates whose Daily Report was saved.
  snapshots: string[];
}

/// What "finish through this date" would lock for one page. Reads only.
export const previewFinishThrough = (through: string, location: EntryLocation) =>
  http.get<FinishPlan>(`/day-closures/finish-through/preview?through=${through}&location=${location}`);
/// Finishes every unfinished period of one page up to the date, oldest first,
/// all or nothing. A plan with warnings is refused (409) until acknowledged.
export const finishThrough = (through: string, location: EntryLocation, acknowledgeWarnings: boolean) =>
  http.post<FinishThroughResult>("/day-closures/finish-through", { through, location, acknowledgeWarnings });

/* -------------------------------------------------------- month closures */

export interface MonthClosure {
  id: number;
  yearMonth: string;
  isClosed: boolean;
  closedAt: string;
  closedBy: { id: number; name: string } | null;
  unlockedAt: string | null;
  unlockedBy: { id: number; name: string } | null;
  unlockReason: string | null;
}

export interface MonthReadiness {
  yearMonth: string;
  ready: boolean;
  problems: string[];
  warnings: string[];
  periodsWithEntries: number;
}

export const listMonthClosures = () => http.get<MonthClosure[]>("/month-closures");
export const getMonthReadiness = (yearMonth: string) => http.get<MonthReadiness>(`/month-closures/${yearMonth}/readiness`);
export const closeMonth = (yearMonth: string) => http.post<MonthClosure & { warnings: string[] }>(`/month-closures/${yearMonth}/close`, {});
export const unlockMonth = (yearMonth: string, reason: string) => http.post<MonthClosure>(`/month-closures/${yearMonth}/unlock`, { reason });

export const closeDay = (date: string, shift: Shift) => http.post<DayClosure>("/day-closures/close", { date, shift });
/// `location` unlocks one entry page; leave it out to unlock both.
export const unlockDay = (date: string, shift: Shift, reason: string, location?: EntryLocation) =>
  http.post<DayClosure>("/day-closures/unlock", { date, shift, reason, ...(location ? { location } : {}) });

/// An encoder's ask for a finished page to be unlocked. Waits in the Admin
/// Queue and is answered when the page is unlocked.
export interface UnlockRequest {
  id: number;
  reason: string;
  requestedAt: string;
}
export const requestUnlock = (date: string, shift: Shift, location: EntryLocation, reason: string) =>
  http.post<UnlockRequest & { alreadyRequested: boolean }>("/day-closures/unlock-request", { date, shift, location, reason });
export const getUnlockRequest = (date: string, shift: Shift, location: EntryLocation) =>
  http.get<UnlockRequest | null>(`/day-closures/unlock-request?date=${date}&shift=${shift}&location=${location}`);

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
/// `cascade` also applies the change to the finished days after it (their opening
/// stock moves). Without it each of those days is held for its own approval.
export const approveCorrection = (id: number, note?: string, cascade?: boolean) =>
  http.post<Correction & { snapshotsRefreshed?: string[] }>(`/corrections/${id}/approve`, { note, ...(cascade ? { cascade: true } : {}) });
export const rejectCorrection = (id: number, note: string) => http.post<Correction>(`/corrections/${id}/reject`, { note });

/// A held request for a finished day's opening stock (an earlier day changed, so
/// what carries into it no longer matches). Filed by the system, never typed.
export const STALE_OPENING_FIELD = "openingStock";

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
