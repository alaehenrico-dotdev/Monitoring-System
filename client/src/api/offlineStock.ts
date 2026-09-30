import { http } from "./http";
import type { OfflineEntry, OfflineGridRow, Shift } from "../types";

const SLOT_KEYS = ["delivery1", "delivery2", "delivery3", "delivery4", "delivery5"] as const;

/// Delivery (Out) is the sum of the five delivery slots. Re-derives the slots
/// and their total from a last-saved entry plus a staged diff on top of it -
/// used by OfflineEntryPage's live recompute and its CSV pre-check. A staged
/// flat `deliveryOut` (a CSV import) with no slot edits lands in slot 1, same
/// as the server does when saving it.
export function computeDeliverySlots(entry: Record<string, unknown>, changes: Record<string, number>) {
  const slots = {} as Record<(typeof SLOT_KEYS)[number], number>;
  if (SLOT_KEYS.some((k) => changes[k] !== undefined)) {
    for (const k of SLOT_KEYS) slots[k] = changes[k] ?? Number(entry[k] ?? 0);
  } else if (changes.deliveryOut !== undefined) {
    for (const k of SLOT_KEYS) slots[k] = k === "delivery1" ? changes.deliveryOut : 0;
  } else {
    for (const k of SLOT_KEYS) slots[k] = Number(entry[k] ?? 0);
  }
  const deliveryOut = SLOT_KEYS.reduce((sum, k) => sum + slots[k], 0);
  return { ...slots, deliveryOut };
}

export function getOfflineGrid(date: string, shift: Shift) {
  return http.get<OfflineGridRow[]>(`/offline-stock?date=${date}&shift=${shift}`);
}

export interface OfflineEntryInput {
  stockInOlToOff?: number;
  stockOutOffToOl?: number;
  productionIn?: number;
  deliveryOut?: number;
  delivery1?: number;
  delivery2?: number;
  delivery3?: number;
  delivery4?: number;
  delivery5?: number;
  upsellOut?: number;
  backloads?: number;
}

/// Returns the saved row so the caller can merge it into local state instead
/// of re-fetching the whole grid after every keystroke.
export function saveOfflineEntry(productId: number, date: string, shift: Shift, changes: OfflineEntryInput | Record<string, number>) {
  return http.put<OfflineEntry>(`/offline-stock/${productId}?date=${date}&shift=${shift}`, changes);
}
