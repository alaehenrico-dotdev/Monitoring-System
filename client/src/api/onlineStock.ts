import { http } from "./http";
import type { OnlineEntry, OnlineGridRow, Shift } from "../types";
import { ONLINE_TRANSFER_FIELDS } from "../tauri/sync/offlineFields";

/// Falls back to the structured local SQLite mirror (see
/// tauri/sync/localGrid.ts) when this is a genuine connectivity failure and
/// the generic exact-URL cache (http.ts's own offline fallback) has nothing
/// for this exact date/shift either - e.g. the server hasn't been started
/// yet and this is the first time today's grid has ever been opened on this
/// device. Never trusted as authoritative - the server remains the one
/// source of truth, recomputed fresh on every real request and every sync.
export async function getOnlineGrid(date: string, shift: Shift): Promise<OnlineGridRow[]> {
  try {
    return await http.get<OnlineGridRow[]>(`/online-stock?date=${date}&shift=${shift}`);
  } catch (err) {
    if (!isTauri || !(err instanceof TypeError)) throw err;
    const { getLocalOnlineGrid } = await import("../tauri/sync/localGrid");
    return getLocalOnlineGrid(date, shift);
  }
}

export interface OnlineEntryInput {
  stockInOffToOl?: number;
  stockOutOlToOff?: number;
  productionIn?: number;
  fulfillmentOut?: number;
  rts?: number;
}

const isTauri = import.meta.env.MODE === "tauri";

/// Returns the saved row so the caller can merge it into local state instead
/// of re-fetching the whole (up to ~60 product) grid after every keystroke.
///
/// In the Tauri build, a genuine connectivity failure (not a validation
/// rejection - see isNetworkError's reasoning in http.ts) falls back to
/// staging the edit in the local sync mirror (sync/localDb.ts's
/// stageOnlineEdit) instead of failing outright - additive fields merge with
/// whatever the server has once this client reconnects (sync/engine.ts).
/// Transfer fields are never staged this way (ONLINE_TRANSFER_FIELDS) - the
/// live grid disables those cells while offline (see OnlineEntryPage), so
/// reaching this with one set is almost always a stale read from before the
/// connection dropped; surfaced as a clear rejection rather than silently
/// dropped or incorrectly merged.
export async function saveOnlineEntry(productId: number, date: string, shift: Shift, input: OnlineEntryInput): Promise<OnlineEntry> {
  try {
    return await http.put<OnlineEntry>(`/online-stock/${productId}?date=${date}&shift=${shift}`, input);
  } catch (err) {
    if (!isTauri || !(err instanceof TypeError)) throw err;

    const attemptedTransfer = ONLINE_TRANSFER_FIELDS.some((f) => input[f] !== undefined);
    if (attemptedTransfer) {
      // `new Error(message, { cause })` needs an ES2022 lib - this project
      // targets ES2020 (tsconfig.json), so cause is set as a plain property
      // instead. Same runtime behavior either way.
      const rejection = new Error("Online<->Offline transfers can't be saved offline - reconnect first, then try again.");
      (rejection as Error & { cause?: unknown }).cause = err;
      throw rejection;
    }

    const { stageOnlineEdit } = await import("../tauri/sync/localDb");
    const preview = await stageOnlineEdit(productId, date, shift, input);
    return {
      productId: preview.productId,
      entryDate: `${preview.entryDate}T00:00:00.000Z`,
      shift: preview.shift,
      openingStock: preview.openingStock,
      stockInOffToOl: preview.stockInOffToOl,
      stockOutOlToOff: preview.stockOutOlToOff,
      onlineStock: preview.onlineStock,
      productionIn: preview.productionIn,
      fulfillmentOut: preview.fulfillmentOut,
      rts: preview.rts,
      remainingStock: preview.remainingStock,
    };
  }
}
