import { http } from "./http";
import type { OfflineEntry, OfflineGridRow } from "../types";

export function getOfflineGrid(date: string) {
  return http.get<OfflineGridRow[]>(`/offline-stock?date=${date}`);
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
export function saveOfflineEntry(productId: number, date: string, input: OfflineEntryInput) {
  return http.put<OfflineEntry>(`/offline-stock/${productId}?date=${date}`, input);
}
