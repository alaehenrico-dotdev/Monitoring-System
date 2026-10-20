import type { Shift } from "@prisma/client";
import { HttpError } from "../utils/HttpError";
import { parseDateOnly } from "../utils/date";
import { serializableTransaction } from "../lib/prisma";
import { broadcastRealtimeEvent } from "../lib/realtime";
import { productRepository } from "../repositories/productRepository";
import { sheetExtraColumnRepository } from "../repositories/sheetExtraColumnRepository";
import { saveOnlineEntry } from "./dailyOnlineStock.service";
import { saveOfflineEntry } from "./dailyOfflineStock.service";
import { logSystemEvent } from "./changeLog.service";
import { getSheetStateAt } from "./sheetHistory.service";
import { EXTRA_COLUMNS, MAX_EXTRAS_PER_COLUMN, type StockExtraInput } from "../utils/stockExtras";
import { toNum } from "../utils/stockMath";

/// The figures an encoder types on each sheet. Opening Stock (carried forward by
/// the system) and the calculated columns are deliberately not restored: they
/// follow from these.
const FIGURES = {
  online: ["stockInOffToOl", "stockOutOlToOff", "productionIn", "fulfillmentOut", "rts"],
  offline: ["stockInOlToOff", "stockOutOffToOl", "productionIn", "deliveryOut", "backloads", "upsellOut"],
} as const;

export type RestorableSheet = keyof typeof FIGURES;

const EXTRA_KEY = /^(.+)__x(\d+)$/;

/// The added-column amounts inside one snapshot (`deliveryOut__x2: 5`), limited
/// to columns that may carry extras on this sheet.
function extrasOf(kind: RestorableSheet, snap: Record<string, unknown>): StockExtraInput[] {
  const allowed = new Set<string>(EXTRA_COLUMNS[kind === "online" ? "ONLINE" : "OFFLINE"]);
  const out: StockExtraInput[] = [];
  for (const [key, value] of Object.entries(snap)) {
    const m = EXTRA_KEY.exec(key);
    if (!m || !allowed.has(m[1])) continue;
    const slotIndex = Number(m[2]);
    if (slotIndex < 1 || slotIndex > MAX_EXTRAS_PER_COLUMN) continue;
    out.push({ columnKey: m[1], slotIndex, amount: toNum(value as never) });
  }
  return out;
}

export interface RestoreResult {
  /// Products whose row was written back.
  restored: number;
  /// Products whose transfer change was held for an admin (the other page is finished).
  held: number;
  /// Products left alone because they have been deactivated since that version.
  skipped: number;
}

/**
 * Puts a sheet back the way it stood at change `upTo`: every product's figures
 * (and added-column amounts) are written back through the ordinary entry save,
 * so locks, the change log, carry-forward and the Online/Offline mirror all
 * behave exactly as if someone had typed the old figures in. Nothing in the
 * history is rewritten - the restore is itself a new set of edits, and the
 * version it came from stays listed.
 *
 * All products are written in ONE transaction: a restore that fails halfway
 * (a locked day, say) leaves the sheet untouched. Products that did not exist
 * at that version are set back to zero rather than deleted.
 */
export async function restoreSheetVersion(
  kind: RestorableSheet,
  date: string,
  shift: Shift,
  upTo: number,
  userId?: number,
): Promise<RestoreResult> {
  const entryDate = parseDateOnly(date);
  const target = await getSheetStateAt(kind, date, shift, upTo);
  if (!target) throw HttpError.notFound("That version no longer exists for this sheet.");

  const figureKeys = FIGURES[kind];
  const location = kind === "online" ? "ONLINE" : "OFFLINE";
  const targetByProduct = new Map<number, Record<string, unknown>>();
  for (const snap of target.values()) {
    if (typeof snap.productId === "number") targetByProduct.set(snap.productId, snap);
  }

  // Only active products can be saved (the entry save refuses the rest). One
  // deactivated since that version must not abort the whole restore, so it is
  // left out and counted instead.
  const activeIds = new Set((await productRepository.findActive()).map((p) => p.id));

  // The sheet's added columns after the restore: every slot that any product's
  // snapshot carries. Each product is then written with ALL of those slots
  // (zero where it had none) - the same shape the entry page itself sends - so
  // stored amounts and the sheet layout stay in step across products.
  const slotsByColumn = new Map<string, Set<number>>();
  const extrasByProduct = new Map<number, StockExtraInput[]>();
  for (const [productId, snap] of targetByProduct) {
    const extras = extrasOf(kind, snap);
    extrasByProduct.set(productId, extras);
    for (const e of extras) slotsByColumn.set(e.columnKey, (slotsByColumn.get(e.columnKey) ?? new Set()).add(e.slotIndex));
  }
  const hasFigures = (row: Record<string, unknown>) => figureKeys.some((k) => toNum(row[k] as never) !== 0);

  const result: RestoreResult = { restored: 0, held: 0, skipped: 0 };
  await serializableTransaction(async (tx) => {
    // The transaction can be retried; start each attempt from zero. What the
    // sheet holds NOW is read inside it, so a save by someone else between the
    // read and the commit cannot leave a product or a column out.
    result.restored = 0;
    result.held = 0;
    result.skipped = 0;
    const currentRows = (await (kind === "online"
      ? tx.dailyOnlineStock.findMany({ where: { entryDate, shift } })
      : tx.dailyOfflineStock.findMany({ where: { entryDate, shift } }))) as unknown as Record<string, unknown>[];
    const currentLayout = await sheetExtraColumnRepository.findForSheet(location, entryDate, shift, tx);
    // Columns the sheet has now but the restored version did not: dropped.
    const clearExtraColumns = [...new Set(currentLayout.map((c) => c.columnKey))].filter((c) => !slotsByColumn.has(c));
    const productIds = new Set<number>(targetByProduct.keys());
    for (const row of currentRows) if (hasFigures(row)) productIds.add(row.productId as number);

    for (const productId of [...productIds].sort((a, b) => a - b)) {
      if (!activeIds.has(productId)) {
        result.skipped += 1;
        continue;
      }
      const snap = targetByProduct.get(productId);
      const figures: Record<string, number> = {};
      for (const k of figureKeys) figures[k] = snap ? toNum(snap[k] as never) : 0;
      const mine = new Map((extrasByProduct.get(productId) ?? []).map((e) => [`${e.columnKey}:${e.slotIndex}`, e.amount]));
      const extras: StockExtraInput[] = [];
      for (const [columnKey, slots] of slotsByColumn) {
        const sorted = [...slots].sort((a, b) => a - b);
        // The save derives a column's total from its amounts, so a product that
        // was saved before the column was split (no amounts of its own in this
        // snapshot) would be zeroed. Its flat total goes into the first slot -
        // the same move the entry page makes when the first column is added.
        const hasOwn = sorted.some((slotIndex) => mine.has(`${columnKey}:${slotIndex}`));
        for (const [i, slotIndex] of sorted.entries()) {
          const own = mine.get(`${columnKey}:${slotIndex}`);
          extras.push({ columnKey, slotIndex, amount: own ?? (!hasOwn && i === 0 ? (figures[columnKey] ?? 0) : 0) });
        }
      }
      const input = { ...figures, extras, clearExtraColumns };
      const saved =
        kind === "online"
          ? await saveOnlineEntry(productId, entryDate, shift, input, userId, tx)
          : await saveOfflineEntry(productId, entryDate, shift, input, userId, tx);
      result.restored += 1;
      if ((saved as { heldForApproval?: unknown[] }).heldForApproval?.length) result.held += 1;
    }
  });

  await logSystemEvent("sheet_version_restore", { sheet: kind, entryDate: date, shift, upTo, restored: result.restored, held: result.held, skipped: result.skipped }, userId);
  broadcastRealtimeEvent();
  return result;
}
