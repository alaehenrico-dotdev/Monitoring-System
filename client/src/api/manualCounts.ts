import type { AuditSnapshot } from "../utils/auditSnapshot";
import { http } from "./http";
import type {
  ManualCountEntry,
  ManualCountGridRow,
  Shift,
  StockLocation,
} from "../types";

export function getManualCountGrid(
  date: string,
  shift: Shift,
  location: StockLocation,
): Promise<ManualCountGridRow[]> {
  return http.get(
    `/manual-counts?date=${date}&shift=${shift}&location=${location}`,
  );
}

export function saveManualCount(
  productId: number,
  date: string,
  shift: Shift,
  location: StockLocation,
  manualCount: number | null,
  importBatchId?: number,
): Promise<ManualCountEntry> {
  return http.put(
    `/manual-counts/${productId}?date=${date}&shift=${shift}&location=${location}`,
    { manualCount, importBatchId },
  );
}

export interface VarianceReportFilters {
  startDate: string;
  endDate: string;
  productId?: number;
  category?: string;
  location?: StockLocation;
  shift?: Shift;
  flaggedOnly?: boolean;
}

export function getVarianceReport(filters: VarianceReportFilters) {
  const params = new URLSearchParams();
  params.set("startDate", filters.startDate);
  params.set("endDate", filters.endDate);
  if (filters.productId) params.set("productId", String(filters.productId));
  if (filters.category) params.set("category", filters.category);
  if (filters.location) params.set("location", filters.location);
  if (filters.shift) params.set("shift", filters.shift);
  if (filters.flaggedOnly !== undefined)
    params.set("flaggedOnly", String(filters.flaggedOnly));
  return http.get(`/reports/variance?${params.toString()}`);
}

/// Everything behind one count's variance (see server getVarianceTrace).
export interface VarianceTraceItem {
  at: string;
  who: string | null;
  what: "Count" | "Entry";
  action: "CREATE" | "UPDATE" | "DELETE";
  summary: string;
  /// Made by the system as a consequence of another change, not by `who`.
  auto: boolean;
  /// An entry edit made after the count was last saved.
  afterCount: boolean;
}

export interface VarianceTrace {
  product: { id: number; sku: string | null; name: string };
  location: "ONLINE" | "OFFLINE";
  entryDate: string;
  shift: Shift;
  count: {
    manualCount: number;
    systemRemainingStock: number;
    variance: number;
    remarks: string | null;
    countedBy: string | null;
    countedAt: string | null;
    publishedAt: string | null;
    /// Published with "use as next day's opening stock" ticked.
    appliedToOpening?: boolean;
  } | null;
  opening: { expected: number; actual: number; isBreak: boolean; source: "count" | "system" };
  entrySaved: boolean;
  encodedBy: string | null;
  figures: { label: string; value: string }[];
  history: VarianceTraceItem[];
}

export function getVarianceTrace(
  productId: number,
  date: string,
  shift: Shift,
  location: "ONLINE" | "OFFLINE",
) {
  return http.get<VarianceTrace>(
    `/manual-counts/trace?productId=${productId}&date=${date}&shift=${shift}&location=${location}`,
  );
}

/// The reason a saved count differs from the system figure. "" clears it.
export function setCountRemarks(
  productId: number,
  date: string,
  shift: Shift,
  location: StockLocation,
  remarks: string,
) {
  return http.patch<ManualCountEntry>(
    `/manual-counts/${productId}/remarks?date=${date}&shift=${shift}&location=${location}`,
    { remarks: remarks.trim() === "" ? null : remarks },
  );
}

/// Approves a sheet's saved counts (one date + shift, every location) as final.
/// With `applyToOpening` they also start a new record: the next day entered
/// opens at the counted figure and carries on from there. Days already saved
/// are left as they are (`leftSaved` says how many counted products have some).
/// Supervisor/Admin only.
export function publishManualCounts(date: string, shift: Shift, applyToOpening = false) {
  return http.post<{ published: number; publishedAt: string; appliedToOpening?: boolean; leftSaved?: number; snapshotId?: number }>(
    `/manual-counts/publish?date=${date}&shift=${shift}`,
    { applyToOpening },
  );
}

/// Where a published audit stands (Audit History): reverted, and whether it can
/// still be reverted (its counts still carry that publish).
export interface AuditSnapshotState {
  id: number;
  reverted: boolean;
  revertedAt: string | null;
  canRevert: boolean;
}

export function getAuditSnapshotStates(ids: number[]) {
  return http.get<AuditSnapshotState[]>(`/manual-counts/snapshots/states?ids=${ids.join(",")}`);
}

/// Sends a published audit back to unpublished so it can be re-audited. Admin only.
export function revertAuditSnapshot(id: number, reason: string) {
  return http.post<{ snapshotId: number; reverted: number; keptManual: number; heldLocked: number }>(
    `/manual-counts/snapshots/${id}/revert`,
    { reason },
  );
}

/// A published audit exactly as it was released - what Audit History reopens.
export function getAuditSnapshot(id: number) {
  return http.get<AuditSnapshot>(`/manual-counts/snapshots/${id}`);
}
