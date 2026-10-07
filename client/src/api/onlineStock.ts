import { http } from "./http";
import type { OnlineEntry, OnlineGridRow, Shift } from "../types";

export async function getOnlineGrid(date: string, shift: Shift): Promise<OnlineGridRow[]> {
  return http.get<OnlineGridRow[]>(`/online-stock?date=${date}&shift=${shift}`);
}

export interface OnlineEntryInput {
  stockInOffToOl?: number;
  stockOutOlToOff?: number;
  productionIn?: number;
  fulfillmentOut?: number;
  rts?: number;
}

export async function saveOnlineEntry(productId: number, date: string, shift: Shift, input: OnlineEntryInput): Promise<OnlineEntry> {
  return http.put<OnlineEntry>(
    `/online-stock/${productId}?date=${date}&shift=${shift}`,
    input,
  );
}
