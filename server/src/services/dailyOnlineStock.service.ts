import { DailyOnlineStock, Shift } from "@prisma/client";
import { prisma, serializableTransaction, type Db } from "../lib/prisma";
import { dailyOnlineStockRepository } from "../repositories/dailyOnlineStockRepository";
import { dailyOfflineStockRepository } from "../repositories/dailyOfflineStockRepository";
import { productRepository } from "../repositories/productRepository";
import { dailyStockExtraRepository } from "../repositories/dailyStockExtraRepository";
import { recordChange } from "./changeLog.service";
import { broadcastRealtimeEvent } from "../lib/realtime";
import { propagateOpeningStock } from "./manualCounts.service";
import { HttpError } from "../utils/HttpError";
import {
  columnKeysOf,
  flattenExtras,
  totalsFromExtras,
  validateExtras,
  type StockExtraInput,
} from "../utils/stockExtras";
import {
  calculateOfflineRemaining,
  calculateOfflineStock,
  calculateOnlineRemaining,
  calculateOnlineStock,
  isNegativeStock,
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
export function computeOpeningStock(productId: number, entryDate: Date, shift: Shift, db: Db = prisma): Promise<number> {
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
/// Opening stocks for every missing row are fetched in one batched call
/// rather than one query per product - on a fresh shift, most/all of the
/// ~60 products in the master list won't have a row yet, so the naive
/// per-product await turned every grid load into an N+1 query storm.
export async function getOnlineGrid(entryDate: Date, shift: Shift) {
  const products = await productRepository.findActive();
  const rows = await dailyOnlineStockRepository.findAllForDate(entryDate, shift);
  const rowByProduct = new Map(rows.map((r) => [r.productId, r]));

  // Added columns (utils/stockExtras.ts) for the whole sheet in one query,
  // flattened onto each row so the grid reads an added column's cell exactly
  // like any other. The main column already carries their total, so a client
  // that ignores these entirely still shows correct figures.
  const extraRows = await dailyStockExtraRepository.findAllForDate("ONLINE", entryDate, shift);
  const extrasByProduct = new Map<number, typeof extraRows>();
  for (const e of extraRows) extrasByProduct.set(e.productId, [...(extrasByProduct.get(e.productId) ?? []), e]);

  const missingProductIds = products.filter((p) => !rowByProduct.has(p.id)).map((p) => p.id);
  const openingStockByProduct = await dailyOnlineStockRepository.getOpeningStocksForProducts(missingProductIds, entryDate, shift);

  return products.map((product) => {
    const extras = extrasByProduct.get(product.id) ?? [];
    const existing = rowByProduct.get(product.id);
    if (existing) return { product, entry: { ...existing, ...flattenExtras(extras) }, isSaved: true };

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
      entry: { productId: product.id, entryDate, shift, openingStock, ...zero, onlineStock, remainingStock, ...flattenExtras(extras) },
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
): Promise<DailyOnlineStock> {
  if (!db) {
    const saved = await serializableTransaction((tx) => saveOnlineEntry(productId, entryDate, shift, input, userId, tx));
    broadcastRealtimeEvent();
    return saved;
  }

  const product = await productRepository.findActiveById(productId, db);
  if (!product) throw HttpError.notFound("Active product not found");
  const existing = await dailyOnlineStockRepository.findByProductAndDate(productId, entryDate, shift, db);

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
  const { onlineStock, remainingStock } = calculate(openingStock, merged);

  // Negative-stock guard (Section: Stock Out cannot exceed what's on hand) -
  // checked against Remaining Stock, the actual current balance, not the
  // onlineStock subtotal alone (Production/RTS can legitimately bring a
  // dip back up before it's actually persisted).
  if (isNegativeStock(remainingStock)) {
    throw HttpError.badRequest(
      `This would take ${product.name}'s Online stock below zero (would end at ${remainingStock}). Reduce Fulfillment (Out) or the transfer out to Offline, or add Production (In)/RTS first.`
    );
  }

  const data = { productId, entryDate, shift, openingStock, ...merged, onlineStock, remainingStock, encodedById: userId };
  const saved = await dailyOnlineStockRepository.upsert(existing?.id, data, db);

  // Columns whose stored amounts this save replaces: the ones it sent amounts
  // for, plus the ones it asked to clear ("Save total only").
  const touchedColumns = [...new Set([...columnKeysOf(extras), ...(input.clearExtraColumns ?? [])])];
  const priorExtras = touchedColumns.length
    ? await dailyStockExtraRepository.findForProduct("ONLINE", productId, entryDate, shift, db)
    : [];
  await dailyStockExtraRepository.replaceColumns("ONLINE", productId, entryDate, shift, touchedColumns, extras, userId, db);

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
  await propagateOpeningStock(productId, entryDate, shift, "ONLINE", userId, db, changeId);
  await propagateOpeningStock(productId, entryDate, shift, "OFFLINE", userId, db, changeId);

  // Not broadcast here - the `!db` branch above does it once the transaction
  // that wraps this whole function has actually committed. A caller that
  // passes its own `db`/`tx` in (composing this into a larger transaction)
  // owns broadcasting for itself, once ITS transaction commits.
  return saved;
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

  // Same guard as saveOnlineEntry's own, applied to the side actually being
  // drained here: pulling stock INTO Online FROM Offline (stockInOffToOl on
  // the Online entry) mirrors as Offline's stockOutOffToOl - a real Stock
  // Out for Offline that can't exceed what Offline actually has on hand,
  // even though the transfer itself was entered on the Online grid.
  if (isNegativeStock(remainingStock)) {
    const product = await productRepository.findActiveById(productId, db);
    throw HttpError.badRequest(
      `This transfer would take ${product?.name ?? `product #${productId}`}'s Offline stock below zero (would end at ${remainingStock}).`
    );
  }

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
