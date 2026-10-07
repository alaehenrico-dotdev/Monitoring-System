import { coreRequest, http } from "./http";
import { getKnownReachable } from "./reachability";
import type { ManualCountEntry, ManualCountGridRow, Shift, StockLocation } from "../types";

/// Offline fallback - see api/onlineStock.ts's matching getOnlineGrid for the
/// full reasoning (same structured-mirror fallback, tauri/sync/localGrid.ts).
export async function getManualCountGrid(date: string, shift: Shift, location: StockLocation): Promise<ManualCountGridRow[]> {
  if (isTauri && getKnownReachable() === false) {
    const { getLocalManualCountGrid } = await import("../tauri/sync/localGrid");
    return getLocalManualCountGrid(date, shift, location);
  }
  try {
    return await http.get<ManualCountGridRow[]>(`/manual-counts?date=${date}&shift=${shift}&location=${location}`);
  } catch (err) {
    if (!isTauri || !(err instanceof TypeError)) throw err;
    const { getLocalManualCountGrid } = await import("../tauri/sync/localGrid");
    return getLocalManualCountGrid(date, shift, location);
  }
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
async function stageManualCountAndPreview(
  productId: number,
  date: string,
  shift: Shift,
  location: StockLocation,
  manualCount: number,
): Promise<ManualCountEntry> {
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
/// Goes through coreRequest and checks getKnownReachable() itself, not
/// http.put - see saveOnlineEntry's matching comment (api/onlineStock.ts)
/// for why: http.ts's generic request() would otherwise intercept a network
/// failure here before this function's own, conflict-aware stageManualCount
/// fallback ever ran.
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
  /// null clears a count that didn't exist before this save - only Undo
  /// passes this (reverting a save that *created* a count has nothing to
  /// restore it to but absent; see OnlineEntryPage/OfflineEntryPage's
  /// handleUndoLastSave).
  manualCount: number | null,
  /// Set only when this save is committing a value a confirmed CSV import
  /// staged (see CsvTools.tsx) - tags the server's change_log row so Import
  /// History can find and, if needed, revert exactly this write.
  importBatchId?: number,
): Promise<ManualCountEntry> {
  // The offline outbox (tauri/sync/localDb.ts's manual_counts_pending table)
  // only has room to stage a desired absolute count, not "clear it back to
  // absent" - that would need its own pending-delete bookkeeping through the
  // structured sync engine, which doesn't exist yet. Surfacing this plainly
  // beats silently staging the wrong thing or dropping it - checked up front
  // (not just in the catch below) so a known-unreachable server fails fast
  // here too, same as the staged-count case does.
  if (manualCount === null && isTauri && getKnownReachable() === false) {
    throw new Error(
      "Can't undo this product's manual count while offline - the server is unreachable and clearing a count can't be queued yet. Reconnect and try Undo again.",
    );
  }
  if (manualCount !== null && isTauri && getKnownReachable() === false) {
    return stageManualCountAndPreview(productId, date, shift, location, manualCount);
  }

  try {
    return await coreRequest<ManualCountEntry>(`/manual-counts/${productId}?date=${date}&shift=${shift}&location=${location}`, {
      method: "PUT",
      body: JSON.stringify({ manualCount, importBatchId }),
    });
  } catch (err) {
    if (!isTauri || !(err instanceof TypeError)) throw err;
    if (manualCount === null) {
      throw new Error(
        "Can't undo this product's manual count while offline - the server is unreachable and clearing a count can't be queued yet. Reconnect and try Undo again.",
        { cause: err },
      );
    }

    return stageManualCountAndPreview(productId, date, shift, location, manualCount);
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
