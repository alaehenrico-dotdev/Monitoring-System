import { StockLocation } from "@prisma/client";

/**
 * Extra input columns added to one Online/Offline grid column from its
 * header's right-click menu (client: hooks/useExtraColumns.ts).
 *
 * The column they were added to stays the single source of truth: it is a
 * real column on daily_online_stock / daily_offline_stock and holds the TOTAL
 * of its extras, which is what Remaining Stock, the subtotal/grand-total rows,
 * the variance and every report go on reading. This module owns the two rules
 * that keep the two from ever disagreeing:
 *
 *   - which columns may have extras at all (`EXTRA_COLUMNS`), and
 *   - that the main column equals the sum of them (`totalsFromExtras`), which
 *     the save path applies server-side rather than trusting the client's own
 *     arithmetic.
 */

/// Same cap the client's menu enforces (useExtraColumns.MAX_EXTRAS_PER_COLUMN).
export const MAX_EXTRAS_PER_COLUMN = 10;

/// Columns that may carry extras - the editable movement columns of each
/// grid, and only those. Calculated columns (Online/Offline Stock, Remaining
/// Stock) and the carried-forward Opening Stock are excluded, because their
/// value is derived from something other than a sum of entered amounts.
///
/// Delivery (Out) is in the list: it used to have exactly five fixed slot
/// columns of its own (delivery1..delivery5), which was both a second
/// mechanism for the same job and an arbitrary limit. Those five columns are
/// still its storage for the first five added columns (DELIVERY_EXTRA_SLOTS
/// below), so nothing already entered was lost.
export const EXTRA_COLUMNS: Record<"ONLINE" | "OFFLINE", readonly string[]> = {
  ONLINE: ["stockInOffToOl", "stockOutOlToOff", "productionIn", "fulfillmentOut", "rts"],
  OFFLINE: ["stockInOlToOff", "stockOutOffToOl", "productionIn", "deliveryOut", "backloads", "upsellOut"],
};

/// Delivery (Out)'s first five added columns live in the daily_offline_stock
/// columns that used to be its fixed slots, rather than in daily_stock_extra -
/// so a sheet saved before this change keeps showing the same breakdown, and
/// the legacy columns never fall out of step with the total. Added columns
/// beyond the fifth are ordinary daily_stock_extra rows.
export const DELIVERY_COLUMN = "deliveryOut";
export const DELIVERY_LEGACY_SLOTS = 5;
export const deliverySlotField = (slot: number) => `delivery${slot}` as const;

/// Splits Delivery (Out)'s extras into the legacy columns and the rest.
export function splitDeliveryExtras(extras: StockExtraInput[]) {
  const legacy: Record<string, number> = {};
  for (let slot = 1; slot <= DELIVERY_LEGACY_SLOTS; slot++) legacy[deliverySlotField(slot)] = 0;
  const overflow: StockExtraInput[] = [];
  for (const e of extras) {
    if (e.columnKey !== DELIVERY_COLUMN) continue;
    if (e.slotIndex <= DELIVERY_LEGACY_SLOTS) legacy[deliverySlotField(e.slotIndex)] = e.amount;
    else overflow.push(e);
  }
  return { legacy, overflow };
}

/**
 * Delivery (Out)'s added columns as read back off a saved row's legacy slot
 * columns - what makes a sheet entered before this change still show its
 * breakdown.
 *
 * Only a real breakdown counts: a row whose entire delivery sits in slot 1 is
 * just a flat total (that is exactly where a CSV import and a plain typed
 * figure both land), and surfacing an added column for it would put a spurious
 * "+1" on every existing sheet. Two or more non-zero slots means someone
 * actually split the figure up.
 */
export function deliveryExtrasFromLegacy(row: Record<string, unknown>): { columnKey: string; slotIndex: number; amount: number }[] {
  const used: { columnKey: string; slotIndex: number; amount: number }[] = [];
  for (let slot = 1; slot <= DELIVERY_LEGACY_SLOTS; slot++) {
    const amount = Number(row[deliverySlotField(slot)] ?? 0);
    if (amount !== 0) used.push({ columnKey: DELIVERY_COLUMN, slotIndex: slot, amount });
  }
  return used.length >= 2 ? used : [];
}

export interface StockExtraInput {
  columnKey: string;
  slotIndex: number;
  amount: number;
}

/// Wire format for one added column's cell, shared with the client: the main
/// column's key, then the slot number. The client builds exactly this key
/// (useExtraColumns.extraColumnKey) and reads it straight off the grid row, so
/// the two spellings must stay identical.
export function extraCellKey(columnKey: string, slotIndex: number): string {
  return `${columnKey}__x${slotIndex}`;
}

export function isExtraColumn(location: StockLocation, columnKey: string): boolean {
  if (location === "TOTAL") return false;
  return EXTRA_COLUMNS[location].includes(columnKey);
}

/// The amounts flattened onto a grid row, so the client reads an added
/// column's cell exactly like any other (`row.entry[key]`).
export function flattenExtras(extras: { columnKey: string; slotIndex: number; amount: unknown }[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const e of extras) out[extraCellKey(e.columnKey, e.slotIndex)] = Number(e.amount);
  return out;
}

/**
 * The main-column totals implied by a set of extras: `{ fulfillmentOut: 12 }`
 * for three added Fulfillment columns of 5, 4 and 3.
 *
 * This is what makes the client and server unable to disagree - the save path
 * overwrites whatever the client sent for these columns with the sum computed
 * here, so a client that miscounts (or a hand-crafted request) can't store a
 * total that doesn't match the amounts behind it.
 */
export function totalsFromExtras(extras: StockExtraInput[]): Record<string, number> {
  const totals: Record<string, number> = {};
  for (const e of extras) totals[e.columnKey] = (totals[e.columnKey] ?? 0) + e.amount;
  return totals;
}

/// The distinct main columns a set of extras touches.
export function columnKeysOf(extras: StockExtraInput[]): string[] {
  return [...new Set(extras.map((e) => e.columnKey))];
}

/// Validation the zod schema can't express on its own: the column must be one
/// that may carry extras on THIS grid, and no column may exceed the cap or
/// repeat a slot. Returns an error message, or undefined when the set is fine.
export function validateExtras(location: "ONLINE" | "OFFLINE", extras: StockExtraInput[]): string | undefined {
  const seen = new Map<string, Set<number>>();
  for (const e of extras) {
    if (!isExtraColumn(location, e.columnKey)) {
      return `"${e.columnKey}" is not a column that can have extra columns.`;
    }
    const slots = seen.get(e.columnKey) ?? new Set<number>();
    if (slots.has(e.slotIndex)) {
      return `"${e.columnKey}" has two amounts for the same added column (+${e.slotIndex}).`;
    }
    slots.add(e.slotIndex);
    seen.set(e.columnKey, slots);
    if (slots.size > MAX_EXTRAS_PER_COLUMN) {
      return `A column can have at most ${MAX_EXTRAS_PER_COLUMN} extra columns.`;
    }
  }
  return undefined;
}
