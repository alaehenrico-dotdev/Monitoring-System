import { http } from "./http";
import type { OfflineEntry, OfflineGridRow, Shift } from "../types";

export async function getOfflineGrid(date: string, shift: Shift): Promise<OfflineGridRow[]> {
  return http.get<OfflineGridRow[]>(`/offline-stock?date=${date}&shift=${shift}`);
}

export interface OfflineEntryInput {
  /// See OnlineEntryInput.openingStock.
  openingStock?: number;
  stockInOlToOff?: number;
  stockOutOffToOl?: number;
  productionIn?: number;
  /// A flat figure, as typed into the column or imported from a CSV. When the
  /// column has been broken into extra columns, `extras` below carries the
  /// amounts and the server recomputes this from them.
  deliveryOut?: number;
  upsellOut?: number;
  backloads?: number;
  /// Added columns' individual amounts ("Save individually") and the columns
  /// whose stored amounts to drop ("Save total only") - see the server's
  /// utils/stockExtras.ts, which recomputes each affected column's total from
  /// these rather than trusting what this request sends for the column itself.
  extras?: { columnKey: string; slotIndex: number; amount: number }[];
  clearExtraColumns?: string[];
}

/// A transfer change the server did not apply because it would also change the
/// other entry page, which is already finished: it waits in the admin's
/// Corrections queue and applies to both pages once approved.
export interface HeldTransfer {
  field: string;
  before: number;
  proposed: number;
}

export async function saveOfflineEntry(
  productId: number,
  date: string,
  shift: Shift,
  changes: OfflineEntryInput | Record<string, number>,
): Promise<OfflineEntry & { heldForApproval?: HeldTransfer[] }> {
  return http.put<OfflineEntry & { heldForApproval?: HeldTransfer[] }>(
    `/offline-stock/${productId}?date=${date}&shift=${shift}`,
    changes,
  );
}
