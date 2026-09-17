import { http } from "./http";
import type { OnlineEntry, OnlineGridRow } from "../types";

export function getOnlineGrid(date: string) {
  return http.get<OnlineGridRow[]>(`/online-stock?date=${date}`);
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
export function saveOnlineEntry(productId: number, date: string, input: OnlineEntryInput) {
  return http.put<OnlineEntry>(`/online-stock/${productId}?date=${date}`, input);
}
