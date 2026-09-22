import { http } from "./http";
import type { OfflineEntry, OfflineGridRow, Shift } from "../types";

/// Column-key prefix for a per-destination Delivery (Out) cell in the grid -
/// see buildOfflineStockColumns (config/stockColumns.ts). Kept here (next to
/// the two functions that translate across it) rather than in the config
/// file, since the grid/CSV/pending-edit machinery never needs to know this
/// prefix exists - only the fetch/save boundary below does.
const DELIVERY_KEY_PREFIX = "delivery:";

export function deliveryColumnKey(destinationId: number): string {
  return `${DELIVERY_KEY_PREFIX}${destinationId}`;
}

/// The grid, CSV export/import, and pending-edit staging all work in flat
/// column keys - one per destination (see deliveryColumnKey) - exactly like
/// every other GridColumn. The wire format nests them instead
/// (deliveryByDestination, keyed by destination id), since that's what maps
/// onto a normal per-destination row server-side. Flattening here, at the
/// fetch boundary, means nothing downstream (StockGrid, usePendingEntryChanges,
/// CsvTools, the PDF/Excel builders) needs a special case for this one field -
/// it's just another number under another column key, same as backloads or
/// upsellOut.
function flattenOfflineEntry(entry: OfflineEntry): Record<string, unknown> {
  const { deliveryByDestination, ...rest } = entry;
  const flat: Record<string, unknown> = { ...rest };
  for (const [destinationId, qty] of Object.entries(deliveryByDestination ?? {})) {
    flat[deliveryColumnKey(Number(destinationId))] = qty;
  }
  return flat;
}

/// The reverse of flattenOfflineEntry - pulls any `delivery:<id>` keys back
/// out of a flat changes/values object (a staged edit or an imported CSV
/// row) and nests them the way the save endpoint expects. Every other key
/// passes through untouched.
export function toOfflineEntryInput(changes: Record<string, number>): OfflineEntryInput {
  const input: OfflineEntryInput = {};
  const deliveryByDestination: Record<number, number> = {};
  for (const [key, value] of Object.entries(changes)) {
    if (key.startsWith(DELIVERY_KEY_PREFIX)) {
      deliveryByDestination[Number(key.slice(DELIVERY_KEY_PREFIX.length))] = value;
    } else {
      (input as Record<string, number>)[key] = value;
    }
  }
  if (Object.keys(deliveryByDestination).length > 0) input.deliveryByDestination = deliveryByDestination;
  return input;
}

/// Mirrors the server's resolveDeliveryOut (dailyOfflineStock.service.ts):
/// folds only the destination(s) actually present in `changes` onto the
/// entry's existing per-destination values, then sums all of them - used by
/// the CSV Review modal's advisory negative-stock pre-check (see
/// OfflineEntryPage's validateImport), which otherwise has no way to know
/// what the new Delivery (Out) total would be for a row that only changed
/// one destination's column. A flat `deliveryOut` in `changes` (no
/// destination sub-keys - the CSV-import backward-compat path) is used
/// directly instead, same as the server does.
export function computeNewDeliveryOut(entry: Record<string, unknown>, changes: Record<string, number>): number {
  const changedDestinationKeys = Object.keys(changes).filter((k) => k.startsWith(DELIVERY_KEY_PREFIX));
  if (changedDestinationKeys.length === 0) {
    return changes.deliveryOut ?? Number(entry.deliveryOut ?? 0);
  }
  const merged = new Map<string, number>();
  for (const key of Object.keys(entry)) {
    if (key.startsWith(DELIVERY_KEY_PREFIX)) merged.set(key, Number(entry[key] ?? 0));
  }
  for (const key of changedDestinationKeys) merged.set(key, changes[key]);
  return [...merged.values()].reduce((sum, qty) => sum + qty, 0);
}

export async function getOfflineGrid(date: string, shift: Shift): Promise<OfflineGridRow[]> {
  const rows = await http.get<OfflineGridRow[]>(`/offline-stock?date=${date}&shift=${shift}`);
  return rows.map((r) => ({ ...r, entry: flattenOfflineEntry(r.entry) as unknown as OfflineEntry }));
}

export interface OfflineEntryInput {
  stockInOlToOff?: number;
  stockOutOffToOl?: number;
  productionIn?: number;
  /// Only the destination(s) actually being changed need to be present -
  /// same partial-update convention as every other field here. Build this
  /// with toOfflineEntryInput rather than by hand.
  deliveryByDestination?: Record<number, number>;
  upsellOut?: number;
  backloads?: number;
}

/// Returns the saved row so the caller can merge it into local state instead
/// of re-fetching the whole grid after every keystroke. Accepts the same
/// flat, column-keyed shape usePendingEntryChanges already stages edits in
/// (a `delivery:<id>` key included) - converting to the nested wire shape,
/// and flattening the response back, both happen here so OfflineEntryPage's
/// stage/save/undo/import flow never has to know the nesting exists.
export function saveOfflineEntry(productId: number, date: string, shift: Shift, changes: Record<string, number>) {
  return http
    .put<OfflineEntry>(`/offline-stock/${productId}?date=${date}&shift=${shift}`, toOfflineEntryInput(changes))
    .then(flattenOfflineEntry) as unknown as Promise<OfflineEntry>;
}
