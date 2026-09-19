import { http } from "./http";
import type { OnlineEntry, OnlineGridRow, Shift } from "../types";

export function getOnlineGrid(date: string, shift: Shift) {
  return http.get<OnlineGridRow[]>(`/online-stock?date=${date}&shift=${shift}`);
}

export interface OnlineEntryInput {
  stockInOffToOl?: number;
  stockOutOlToOff?: number;
  productionIn?: number;
  fulfillmentOut?: number;
  rts?: number;
}

/// Returns the saved row so the caller can merge it into local state instead
/// of re-fetching the whole (up to ~60 product) grid after every keystroke.
export function saveOnlineEntry(productId: number, date: string, shift: Shift, input: OnlineEntryInput) {
  return http.put<OnlineEntry>(`/online-stock/${productId}?date=${date}&shift=${shift}`, input);
}