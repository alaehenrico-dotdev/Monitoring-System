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
  /// Added columns' individual amounts ("Save individually") and the columns
  /// whose stored amounts to drop ("Save total only") - see the server's
  /// utils/stockExtras.ts, which recomputes each affected column's total from
  /// these rather than trusting what this request sends for the column itself.
  extras?: { columnKey: string; slotIndex: number; amount: number }[];
  clearExtraColumns?: string[];
}

export async function saveOnlineEntry(productId: number, date: string, shift: Shift, input: OnlineEntryInput): Promise<OnlineEntry> {
  return http.put<OnlineEntry>(
    `/online-stock/${productId}?date=${date}&shift=${shift}`,
    input,
  );
}
