import { http } from "./http";
import type { ManualCountEntry, ManualCountGridRow, Shift, StockLocation } from "../types";

export function getManualCountGrid(date: string, shift: Shift, location: StockLocation) {
  return http.get<ManualCountGridRow[]>(`/manual-counts?date=${date}&shift=${shift}&location=${location}`);
}

const isTauri = import.meta.env.MODE === "tauri";

/// Returns the saved row (with its freshly-computed variance) so the caller
/// can merge it into local state instead of re-fetching the whole grid.
///
/// Offline fallback - a genuine connectivity failure stages the count
/// locally (sync/localDb.ts's stageManualCount) instead of failing. Unlike
/// the additive online/offline fields, a manual count is NOT merged on
/// sync - if the server's value has also changed by then, it's flagged as a
/// real conflict for the Sync Conflicts screen to resolve, never silently
/// overwritten either way.
///
/// `systemRemainingStock` isn't available to this call (the page only ever
/// passes productId/date/shift/location/manualCount) - looked up from
/// whatever the grid's own GET response last cached (the generic
/// cache/outbox - offlineStore.ts - already holds it, since getManualCountGrid
/// goes through the same http.get()) rather than guessed at. If that's
/// missing too (never loaded this grid before going offline), 0 is used as
/// a last resort - cosmetic only, since systemRemainingStock/variance are
/// always recomputed authoritatively server-side once this syncs.
export async function saveManualCount(
  productId: number,
  date: string,
  shift: Shift,
  location: StockLocation,
  manualCount: number,
  /// Set only when this save is committing a value a confirmed CSV import
  /// staged (see CsvTools.tsx) - tags the server's change_log row so Import
  /// History can find and, if needed, revert exactly this write.
  importBatchId?: number,
): Promise<ManualCountEntry> {
  try {
    return await http.put<ManualCountEntry>(`/manual-counts/${productId}?date=${date}&shift=${shift}&location=${location}`, {
      manualCount,
      importBatchId,
    });
  } catch (err) {
    if (!isTauri || !(err instanceof TypeError)) throw err;

    const { getCachedResponse } = await import("../tauri/offlineStore");
    const cachedGrid = await getCachedResponse<ManualCountGridRow[]>(`/manual-counts?date=${date}&shift=${shift}&location=${location}`);
    const systemRemainingStock = cachedGrid?.find((r) => r.product.id === productId)?.entry.systemRemainingStock ?? 0;

    const { stageManualCount } = await import("../tauri/sync/localDb");
    const preview = await stageManualCount(productId, date, shift, location, systemRemainingStock, manualCount);
    return {
      productId: preview.productId,
      entryDate: `${preview.entryDate}T00:00:00.000Z`,
      shift: preview.shift,
      location: preview.location,
      systemRemainingStock: preview.systemRemainingStock,
      manualCount: preview.manualCount,
      variance: preview.variance,
    };
  }
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
  if (filters.flaggedOnly !== undefined) params.set("flaggedOnly", String(filters.flaggedOnly));
  return http.get(`/reports/variance?${params.toString()}`);
}
