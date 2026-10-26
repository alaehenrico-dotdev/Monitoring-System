import { DailyOnlineStock, Shift } from "@prisma/client";
import { prisma, serializableTransaction, type Db } from "../lib/prisma";
import { dailyOnlineStockRepository } from "../repositories/dailyOnlineStockRepository";
import { dailyOfflineStockRepository } from "../repositories/dailyOfflineStockRepository";
import { productRepository } from "../repositories/productRepository";
import { dailyStockExtraRepository } from "../repositories/dailyStockExtraRepository";
import { sheetExtraColumnRepository } from "../repositories/sheetExtraColumnRepository";
import { recordChange } from "./changeLog.service";
import { getEntryRules } from "./appSettings.service";
import { combineSplitRows, WHOLE_DAY_COMBINED } from "../utils/wholeDay";
import { assertEarlierDaysFinished, assertPeriodOpen } from "./dayLock.service";
import { holdLockedTransfers, requestHeldTransfers, type HeldTransfer } from "./heldTransfers.service";
import { isNoopSave } from "../utils/noopSave";
import { broadcastRealtimeEvent } from "../lib/realtime";
import { propagateOpeningStock } from "./manualCounts.service";
import { HttpError } from "../utils/HttpError";
import {
  columnKeysOf,
  flattenExtras,
  layoutCells,
  layoutCellsFor,
  sumExtras,
  unionLayouts,
  totalsFromExtras,
  validateExtras,
  type StockExtraInput,
} from "../utils/stockExtras";
import {
  calculateOfflineRemaining,
  calculateOfflineStock,
  calculateOnlineRemaining,
  calculateOnlineStock,
  toNum,
} from "../utils/stockMath";

const TABLE = "daily_online_stock";
const OFFLINE_TABLE = "daily_offline_stock";

export interface OnlineEntryInput {
  stockInOffToOl?: number;
  stockOutOlToOff?: number;
  productionIn?: number;
  fulfillmentOut?: number;
  rts?: number;
  /// Not part of the normal encoder-facing edit (Section 4.6 auto-carries
  /// this forward from the prior shift's Remaining Stock instead) - only
  /// meant for a CSV import seeding a real starting balance on a product's
  /// very first date, where there's nothing to carry forward from yet.
  openingStock?: number;
  /**
   * The individual amounts behind a column that was given extra input columns
   * ("Save individually" - see utils/stockExtras.ts). The columns they belong
   * to are NOT taken from whatever this request also sent for them: their
   * totals are recomputed here from these amounts, so the stored column and
   * the amounts behind it can never disagree.
   */
  extras?: StockExtraInput[];
  /**
   * Columns whose stored extras should be dropped - what "Save total only"
   * sends, so the total survives as the column's own value while the amounts
   * behind it go away. Columns named in `extras` are replaced regardless and
   * don't need listing here.
   */
  clearExtraColumns?: string[];
}

/// Every stock figure of one Online row, with none of the inputs that are
/// about HOW it is being saved rather than what it holds.
type OnlineFigures = Required<Omit<OnlineEntryInput, "openingStock" | "extras" | "clearExtraColumns">>;

/// Section 4.6 - auto carry-forward (delegated to the repository, which owns
/// the "immediately preceding shift" query).
function computeOpeningStock(productId: number, entryDate: Date, shift: Shift, db: Db = prisma): Promise<number> {
  return dailyOnlineStockRepository.getOpeningStock(productId, entryDate, shift, db);
}

function calculate(opening: number, input: OnlineFigures) {
  const onlineStock = calculateOnlineStock(opening, input.stockInOffToOl, input.stockOutOlToOff);
  const remainingStock = calculateOnlineRemaining(onlineStock, input.productionIn, input.fulfillmentOut, input.rts);
  return { onlineStock, remainingStock };
}

/// One grid row per active product for the given date/shift - persisted rows
/// as-is, missing rows as a "virtual" preview using the carried-forward
/// opening stock (Section 3.1: the grid always shows every product in the
/// master list).
///
/// `combineSplitDay: false` returns the sheet's own rows even in whole-day mode.
/// The Daily Report and its frozen snapshot pass it: they describe what was
/// entered, and must come out the same whichever mode is on.
///
/// Opening stocks for every missing row are fetched in one batched call
/// rather than one query per product - on a fresh shift, most/all of the
/// ~60 products in the master list won't have a row yet, so the naive
/// per-product await turned every grid load into an N+1 query storm.
export async function getOnlineGrid(entryDate: Date, shift: Shift, opts: { combineSplitDay?: boolean } = {}) {
  const products = await productRepository.findActive();
  const rows = await dailyOnlineStockRepository.findAllForDate(entryDate, shift);
  const rowByProduct = new Map(rows.map((r) => [r.productId, r]));

  // Added columns (utils/stockExtras.ts) for the whole sheet in one query,
  // flattened onto each row so the grid reads an added column's cell exactly
  // like any other. The main column already carries their total, so a client
  // that ignores these entirely still shows correct figures.
  const [extraRows, layoutRows] = await Promise.all([dailyStockExtraRepository.findAllForDate("ONLINE", entryDate, shift), sheetExtraColumnRepository.findForSheet("ONLINE", entryDate, shift)]);
  const extrasByProduct = new Map<number, typeof extraRows>();
  for (const e of extraRows) extrasByProduct.set(e.productId, [...(extrasByProduct.get(e.productId) ?? []), e]);
  const layout = layoutCells(layoutRows);

  // Whole-day mode on a day that was entered by shift: the Night sheet shows the
  // two sheets added together, as one read-only row per product.
  const wholeDayView = opts.combineSplitDay !== false && shift === "NIGHT" && !(await getEntryRules()).useShifts;
  const morningRows = wholeDayView ? await dailyOnlineStockRepository.findAllForDate(entryDate, "MORNING") : [];
  const morningByProduct = new Map<number, DailyOnlineStock>(morningRows.map((r) => [r.productId, r]));
  // The Morning sheet's added columns, so the combined view keeps them.
  const [morningExtraRows, morningLayout] =
    morningRows.length > 0
      ? await Promise.all([dailyStockExtraRepository.findAllForDate("ONLINE", entryDate, "MORNING"), sheetExtraColumnRepository.findForSheet("ONLINE", entryDate, "MORNING")])
      : [[], []];
  const splitDay = morningByProduct.size > 0;

  const missingProductIds = products.filter((p) => !rowByProduct.has(p.id) && !morningByProduct.has(p.id)).map((p) => p.id);
  const openingStockByProduct = await dailyOnlineStockRepository.getOpeningStocksForProducts(missingProductIds, entryDate, splitDay ? "MORNING" : shift);

  return products.map((product) => {
    const extras = extrasByProduct.get(product.id) ?? [];
    const existing = rowByProduct.get(product.id);
    if (splitDay && (existing || morningByProduct.has(product.id))) {
      const merged = combineSplitRows(morningByProduct.get(product.id), existing, ["stockInOffToOl", "stockOutOlToOff", "productionIn", "fulfillmentOut", "rts"])!;
      const figures = merged as unknown as OnlineFigures & { openingStock: number };
      const { onlineStock, remainingStock } = calculate(figures.openingStock, figures);
      const combinedExtras = sumExtras(morningExtraRows.filter((e) => e.productId === product.id), extras);
      const combinedLayout = unionLayouts(morningLayout, layoutRows);
      return {
        product,
        entry: { ...merged, shift, onlineStock, remainingStock, ...layoutCellsFor(combinedLayout, combinedExtras, merged as unknown as Record<string, unknown>), ...flattenExtras(combinedExtras), [WHOLE_DAY_COMBINED]: true },
        isSaved: true,
      };
    }
    if (existing) return { product, entry: { ...existing, ...layoutCellsFor(layoutRows, extras, existing as unknown as Record<string, unknown>), ...flattenExtras(extras) }, isSaved: true };

    const openingStock = openingStockByProduct.get(product.id) ?? 0;
    const zero: OnlineFigures = {
      stockInOffToOl: 0,
      stockOutOlToOff: 0,
      productionIn: 0,
      fulfillmentOut: 0,
      rts: 0,
    };
    const { onlineStock, remainingStock } = calculate(openingStock, zero);
    return {
      product,
      entry: { productId: product.id, entryDate, shift, openingStock, ...zero, onlineStock, remainingStock, ...layout, ...flattenExtras(extras) },
      isSaved: false,
    };
  });
}

/// Encoder-facing upsert for one product/date/shift cell row (Section 4.2).
///
/// Wrapped in one DB transaction together with its Offline mirror
/// (mirrorTransferToOffline, below): both upserts and both change-log writes
/// commit or roll back together. Previously these ran as separate
/// sequential awaits - if the mirror's own negative-stock guard threw, the
/// Online row (and its change-log entry) had already committed, leaving the
/// two tables inconsistent (Online records a transfer the Offline side never
/// got) despite the client correctly seeing the save as failed.
///
/// That outer transaction is SERIALIZABLE (serializableTransaction, lib/
/// prisma.ts), not the default REPEATABLE READ - atomicity alone doesn't
/// stop two concurrent saves on the SAME row from each reading the same
/// pre-write Remaining Stock, each computing a non-negative result from it,
/// and both committing a write that - combined - takes the real balance
/// negative even though each one's own guard "passed". See
/// serializableTransaction's own doc comment for how SERIALIZABLE closes
/// that race (and why a transaction conflict there is retried, not an
/// error).
///
/// `db` stays an accepted parameter so related operations can compose this
/// save into a caller-owned transaction without opening a nested transaction.
export async function saveOnlineEntry(
  productId: number,
  entryDate: Date,
  shift: Shift,
  input: OnlineEntryInput,
  userId?: number,
  db?: Db,
): Promise<DailyOnlineStock & { heldForApproval?: HeldTransfer[] }> {
  if (!db) {
    const saved = await serializableTransaction((tx) => saveOnlineEntry(productId, entryDate, shift, input, userId, tx));
    broadcastRealtimeEvent();
    return saved;
  }

  await assertPeriodOpen(entryDate, shift, db, "entry", "ONLINE");
  await assertEarlierDaysFinished(entryDate, db, "ONLINE");
  const product = await productRepository.findActiveById(productId, db);
  if (!product) throw HttpError.notFound("Active product not found");
  const existing = await dailyOnlineStockRepository.findByProductAndDate(productId, entryDate, shift, db);

  // A transfer change that would also rewrite the other page, once that page is
  // finished, is held for an admin instead (heldTransfers.service.ts).
  const split = await holdLockedTransfers("ONLINE", input, existing, entryDate, shift, db);
  const held = split.held;
  input = split.input;
  const withHeld = async <R extends object>(row: R & { id: number }) => {
    if (held.length === 0) return row;
    await requestHeldTransfers("ONLINE", row.id, held, userId, db);
    return { ...row, heldForApproval: held };
  };

  const extras = input.extras ?? [];
  const extrasError = validateExtras("ONLINE", extras);
  if (extrasError) throw HttpError.badRequest(extrasError);
  // The server's own arithmetic, not the client's: a column that was given
  // extra input columns saves the sum of them, whatever this request happened
  // to send for the column itself. That is what makes it impossible for the
  // stored total and the amounts behind it to drift apart.
  const extraTotals = totalsFromExtras(extras);

  const openingStock =
    input.openingStock ?? (existing ? toNum(existing.openingStock) : await computeOpeningStock(productId, entryDate, shift, db));
  const merged: OnlineFigures = {
    stockInOffToOl: extraTotals.stockInOffToOl ?? input.stockInOffToOl ?? toNum(existing?.stockInOffToOl),
    stockOutOlToOff: extraTotals.stockOutOlToOff ?? input.stockOutOlToOff ?? toNum(existing?.stockOutOlToOff),
    productionIn: extraTotals.productionIn ?? input.productionIn ?? toNum(existing?.productionIn),
    fulfillmentOut: extraTotals.fulfillmentOut ?? input.fulfillmentOut ?? toNum(existing?.fulfillmentOut),
    rts: extraTotals.rts ?? input.rts ?? toNum(existing?.rts),
  };
  // An opening set by an import (the grid no longer edits it) is flagged so the
  // carry-forward and an applied count leave it alone from then on.
  const openingManual = input.openingStock !== undefined ? true : (existing?.openingManual ?? false);
  const { onlineStock, remainingStock } = calculate(openingStock, merged);

  // Negative stock is allowed on save: Out figures are often entered before the
  // matching In (production handed in later), and refusing the save leaves the
  // Out unrecorded. The row is flagged negative instead, Finish Day will not lock
  // it without a supervisor's sign-off (dayFinish.service.ts), and the Admin
  // Queue lists it. Remaining Stock is stored as computed.

  if (existing && isNoopSave(existing, openingStock, merged, columnKeysOf(extras).length + (input.clearExtraColumns?.length ?? 0))) {
    return withHeld(existing);
  }

  const data = { productId, entryDate, shift, openingStock, openingManual, ...merged, onlineStock, remainingStock, encodedById: userId };
  const saved = await dailyOnlineStockRepository.upsert(existing?.id, data, db);

  // Columns whose stored amounts this save replaces: the ones it sent amounts
  // for, plus the ones it asked to clear ("Save total only").
  const touchedColumns = [...new Set([...columnKeysOf(extras), ...(input.clearExtraColumns ?? [])])];
  const priorExtras = touchedColumns.length
    ? await dailyStockExtraRepository.findForProduct("ONLINE", productId, entryDate, shift, db)
    : [];
  await dailyStockExtraRepository.replaceColumns("ONLINE", productId, entryDate, shift, touchedColumns, extras, userId, db);
  await sheetExtraColumnRepository.sync("ONLINE", entryDate, shift, extras, input.clearExtraColumns ?? [], db);

  // One change-log entry for the whole save, under this grid's existing table -
  // the extras ride along as extra fields on the same before/after snapshots,
  // which is also what makes the grid's per-cell history work for an added
  // column's cell without any special casing.
  const changeId = await recordChange(
    {
      tableName: TABLE,
      recordId: saved.id,
      action: existing ? "UPDATE" : "CREATE",
      changedById: userId,
      oldValue: existing ? { ...existing, ...flattenExtras(priorExtras) } : existing,
      newValue: { ...saved, ...flattenExtras(extras) },
    },
    db,
  );

  // Section 4.3 "key change from Excel" - a transfer entered once here is
  // mirrored onto the Offline table by writing straight to its repository
  // (not by calling the Offline service), so the two stock services never
  // depend on each other. Mirrored into the same shift, since a transfer is
  // one real-world event happening within a single shift on both sides.
  await mirrorTransferToOffline(
    productId,
    entryDate,
    shift,
    { stockOutOffToOl: merged.stockInOffToOl, stockInOlToOff: merged.stockOutOlToOff },
    userId,
    db,
  );

  // A correction to this period changes the next saved Online opening
  // balance. Transfers are mirrored to Offline in this same transaction,
  // so propagate that side too before the transaction commits.
  await propagateOpeningStock(productId, entryDate, shift, "ONLINE", userId, db, changeId, { from: "period" });
  await propagateOpeningStock(productId, entryDate, shift, "OFFLINE", userId, db, changeId, { from: "period" });

  // Not broadcast here - the `!db` branch above does it once the transaction
  // that wraps this whole function has actually committed. A caller that
  // passes its own `db`/`tx` in (composing this into a larger transaction)
  // owns broadcasting for itself, once ITS transaction commits.
  return withHeld(saved);
}

async function mirrorTransferToOffline(
  productId: number,
  entryDate: Date,
  shift: Shift,
  mirrored: { stockOutOffToOl: number; stockInOlToOff: number },
  userId?: number,
  db: Db = prisma,
) {
  const existing = await dailyOfflineStockRepository.findByProductAndDate(productId, entryDate, shift, db);

  // saveOnlineEntry calls this mirror unconditionally after every save, even
  // when only an unrelated field (e.g. Fulfillment Out) changed and the
  // transfer figures are exactly what the offline side already has. Without
  // this guard that's a no-op write plus a change-log entry with nothing to
  // show for it, on every single Online save.
  if (existing && toNum(existing.stockInOlToOff) === mirrored.stockInOlToOff && toNum(existing.stockOutOffToOl) === mirrored.stockOutOffToOl) {
    return;
  }
  if (!existing && mirrored.stockInOlToOff === 0 && mirrored.stockOutOffToOl === 0) {
    return; // nothing has actually transferred yet - don't create a blank row just to mirror zeros
  }

  const openingStock = existing ? toNum(existing.openingStock) : await dailyOfflineStockRepository.getOpeningStock(productId, entryDate, shift, db);

  const merged = {
    stockInOlToOff: mirrored.stockInOlToOff,
    stockOutOffToOl: mirrored.stockOutOffToOl,
    productionIn: toNum(existing?.productionIn),
    deliveryOut: toNum(existing?.deliveryOut),
    backloads: toNum(existing?.backloads),
    upsellOut: toNum(existing?.upsellOut),
  };
  const offlineStock = calculateOfflineStock(openingStock, merged.stockInOlToOff, merged.stockOutOffToOl);
  const remainingStock = calculateOfflineRemaining(offlineStock, merged.productionIn, merged.deliveryOut, merged.backloads, merged.upsellOut);

  // Same as the own-side save: a mirrored transfer may leave this side negative.

  const data = {
    productId,
    entryDate,
    shift,
    openingStock,
    ...merged,
    offlineStock,
    remainingStock,
    // A mirrored write doesn't reassign whose entry this is; keep the
    // existing encoder attribution if the row already exists.
    encodedById: existing?.encodedById ?? userId,
  };
  const saved = await dailyOfflineStockRepository.upsert(existing?.id, data, db);

  await recordChange(
    {
      tableName: OFFLINE_TABLE,
      recordId: saved.id,
      action: existing ? "UPDATE" : "CREATE",
      changedById: userId,
      oldValue: existing,
      newValue: saved,
    },
    db,
  );
}
