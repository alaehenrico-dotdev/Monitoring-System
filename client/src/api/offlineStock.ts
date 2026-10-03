import { coreRequest, http } from "./http";
import { getKnownReachable } from "./reachability";
import type { OfflineEntry, OfflineGridRow, Shift } from "../types";
import { OFFLINE_TRANSFER_FIELDS } from "../tauri/sync/offlineFields";

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

/// Offline fallback - see api/onlineStock.ts's matching getOnlineGrid for the
/// full reasoning (same structured-mirror fallback, tauri/sync/localGrid.ts).
export async function getOfflineGrid(date: string, shift: Shift): Promise<OfflineGridRow[]> {
  try {
    return await http.get<OfflineGridRow[]>(`/offline-stock?date=${date}&shift=${shift}`);
  } catch (err) {
    if (!isTauri || !(err instanceof TypeError)) throw err;
    const { getLocalOfflineGrid } = await import("../tauri/sync/localGrid");
    return getLocalOfflineGrid(date, shift);
  }
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

const isTauri = import.meta.env.MODE === "tauri";

async function stageOfflineAndPreview(
  productId: number,
  date: string,
  shift: Shift,
  changes: Record<string, number>,
): Promise<OfflineEntry> {
  // deliveryOut (the flat CSV-import total) isn't itself a stageable field -
  // resolveDelivery/computeDeliverySlots already expand it into the five
  // slots server-side (and client-side, for preview) before it ever reaches
  // here; stageOfflineEdit only knows about the slots themselves, same as
  // the server's real additive fields.
  const { deliveryOut: _deliveryOut, ...slotsAndOther } = changes;
  const { stageOfflineEdit } = await import("../tauri/sync/localDb");
  const preview = await stageOfflineEdit(productId, date, shift, slotsAndOther);
  return {
    productId: preview.productId,
    entryDate: `${preview.entryDate}T00:00:00.000Z`,
    shift: preview.shift,
    openingStock: preview.openingStock,
    stockInOlToOff: preview.stockInOlToOff,
    stockOutOffToOl: preview.stockOutOffToOl,
    offlineStock: preview.offlineStock,
    productionIn: preview.productionIn,
    deliveryOut: preview.deliveryOut,
    delivery1: preview.delivery1,
    delivery2: preview.delivery2,
    delivery3: preview.delivery3,
    delivery4: preview.delivery4,
    delivery5: preview.delivery5,
    upsellOut: preview.upsellOut,
    backloads: preview.backloads,
    remainingStock: preview.remainingStock,
  };
}

/// Returns the saved row so the caller can merge it into local state instead
/// of re-fetching the whole grid after every keystroke. Offline fallback -
/// see saveOnlineEntry's matching comment in api/onlineStock.ts, same
/// reasoning applies here (additive fields stage locally and merge on sync;
/// transfer fields are rejected rather than staged, since the live grid
/// disables those cells while offline), including why this goes through
/// coreRequest and checks getKnownReachable() itself rather than going
/// through http.put.
export async function saveOfflineEntry(
  productId: number,
  date: string,
  shift: Shift,
  changes: OfflineEntryInput | Record<string, number>,
): Promise<OfflineEntry> {
  const attemptedTransfer = OFFLINE_TRANSFER_FIELDS.some((f) => (changes as Record<string, number>)[f] !== undefined);

  if (!attemptedTransfer && isTauri && getKnownReachable() === false) {
    return stageOfflineAndPreview(productId, date, shift, changes as Record<string, number>);
  }

  try {
    return await coreRequest<OfflineEntry>(`/offline-stock/${productId}?date=${date}&shift=${shift}`, {
      method: "PUT",
      body: JSON.stringify(changes),
    });
  } catch (err) {
    if (!isTauri || !(err instanceof TypeError)) throw err;

    if (attemptedTransfer) {
      // `new Error(message, { cause })` needs an ES2022 lib - this project
      // targets ES2020 (tsconfig.json), so cause is set as a plain property
      // instead. Same runtime behavior either way.
      const rejection = new Error("Online<->Offline transfers can't be saved offline - reconnect first, then try again.");
      (rejection as Error & { cause?: unknown }).cause = err;
      throw rejection;
    }

    return stageOfflineAndPreview(productId, date, shift, changes as Record<string, number>);
  }
}
