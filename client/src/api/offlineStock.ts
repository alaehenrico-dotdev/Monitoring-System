import { http } from "./http";
import type { OfflineEntry, OfflineGridRow, Shift } from "../types";

export function getOfflineGrid(date: string, shift: Shift) {
  return http.get<OfflineGridRow[]>(`/offline-stock?date=${date}&shift=${shift}`);
}

export interface OfflineEntryInput {
  stockInOlToOff?: number;
  stockOutOffToOl?: number;
  productionIn?: number;
  deliveryOut?: number;
  backloads?: number;
}

/// Returns the saved row so the caller can merge it into local state instead
/// of re-fetching the whole grid after every keystroke.
export function saveOfflineEntry(productId: number, date: string, shift: Shift, input: OfflineEntryInput) {
  return http.put<OfflineEntry>(`/offline-stock/${productId}?date=${date}&shift=${shift}`, input);
}