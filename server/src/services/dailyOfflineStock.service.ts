import { DailyOfflineStock, Shift } from "@prisma/client";
import { prisma, serializableTransaction, type Db } from "../lib/prisma";
import { dailyOfflineStockRepository } from "../repositories/dailyOfflineStockRepository";
import { dailyOnlineStockRepository } from "../repositories/dailyOnlineStockRepository";
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
  DELIVERY_COLUMN,
  deliveryExtrasFromLegacy,
  flattenExtras,
  sumExtras,
  unionLayouts,
  layoutCells,
  layoutCellsFor,
  sheetHasDeliveryBreakdown,
  splitDeliveryExtras,
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

const TABLE = "daily_offline_stock";
const ONLINE_TABLE = "daily_online_stock";

export interface OfflineEntryInput {
  stockInOlToOff?: number;
  stockOutOffToOl?: number;
  productionIn?: number;
  /// Flat total (CSV import). Delivery (Out) is really the sum of the five
  /// slots below; a flat figure with no slots given lands in slot 1.
  deliveryOut?: number;
  delivery1?: number;
  delivery2?: number;
  delivery3?: number;
  delivery4?: number;
  delivery5?: number;
  backloads?: number;
  upsellOut?: number;
  /// See OnlineEntryInput's own doc comment (dailyOnlineStock.service.ts) -
  /// same reasoning, same CSV-import-only exception to auto-carry-forward.
  openingStock?: number;
  /// Added columns' individual amounts, and the columns whose stored amounts
  /// to drop - see OnlineEntryInput, which documents both in full.
  extras?: StockExtraInput[];
  clearExtraColumns?: string[];
}

/// Every stock figure of one Offline row, with none of the inputs that are
/// about HOW it is being saved rather than what it holds.
type OfflineFigures = Required<Omit<OfflineEntryInput, "openingStock" | "extras" | "clearExtraColumns">>;

const DELIVERY_SLOTS = ["delivery1", "delivery2", "delivery3", "delivery4", "delivery5"] as const;

/// Delivery (Out) is always the sum of the five slots - typed in the grid's
/// expandable Delivery columns - never entered on its own.
function resolveDelivery(existing: Record<string, unknown> | null, input: OfflineEntryInput) {
  const slots = {} as Record<(typeof DELIVERY_SLOTS)[number], number>;
  if (DELIVERY_SLOTS.some((k) => input[k] !== undefined)) {
    for (const k of DELIVERY_SLOTS) slots[k] = input[k] ?? toNum(existing?.[k] as never);
  } else if (input.deliveryOut !== undefined) {
    for (const k of DELIVERY_SLOTS) slots[k] = k === "delivery1" ? input.deliveryOut : 0;
  } else {
    for (const k of DELIVERY_SLOTS) slots[k] = toNum(existing?.[k] as never);
    // A row saved before the slots existed has only its flat total.
    if (DELIVERY_SLOTS.every((k) => slots[k] === 0) && existing) slots.delivery1 = toNum(existing.deliveryOut as never);
  }
  const deliveryOut = DELIVERY_SLOTS.reduce((sum, k) => sum + slots[k], 0);
  return { ...slots, deliveryOut };
}

/// Section 4.6 - same shift-aware carry-forward principle as the Online table.
function computeOpeningStock(productId: number, entryDate: Date, shift: Shift, db: Db = prisma): Promise<number> {
  return dailyOfflineStockRepository.getOpeningStock(productId, entryDate, shift, db);
}

function calculate(opening: number, input: OfflineFigures) {
  const offlineStock = calculateOfflineStock(opening, input.stockInOlToOff, input.stockOutOffToOl);
  const remainingStock = calculateOfflineRemaining(offlineStock, input.productionIn, input.deliveryOut, input.backloads, input.upsellOut);
  return { offlineStock, remainingStock };
}

/// Same N+1 avoidance as getOnlineGrid - opening stocks for every row are
/// fetched in one batched call instead of one query per product.
export async function getOfflineGrid(entryDate: Date, shift: Shift, opts: { combineSplitDay?: boolean | "always" } = {}) {
  const products = await productRepository.findActive();
  const rows = await dailyOfflineStockRepository.findAllForDate(entryDate, shift);
  const rowByProduct = new Map(rows.map((r) => [r.productId, r]));

  // Added columns for the whole sheet in one query - see the matching comment
  // in dailyOnlineStock.service.ts's getOnlineGrid.
  const [extraRows, layoutRows] = await Promise.all([dailyStockExtraRepository.findAllForDate("OFFLINE", entryDate, shift), sheetExtraColumnRepository.findForSheet("OFFLINE", entryDate, shift)]);
  const extrasByProduct = new Map<number, typeof extraRows>();
  for (const e of extraRows) extrasByProduct.set(e.productId, [...(extrasByProduct.get(e.productId) ?? []), e]);
  const layout = layoutCells(layoutRows);

  // Whole-day mode on a day that was entered by shift: see getOnlineGrid.
  const wholeDayView = shift === "NIGHT" && (opts.combineSplitDay === "always" || (opts.combineSplitDay !== false && !(await getEntryRules()).useShifts));
  const morningRows = wholeDayView ? await dailyOfflineStockRepository.findAllForDate(entryDate, "MORNING") : [];
  const morningByProduct = new Map<number, DailyOfflineStock>(morningRows.map((r) => [r.productId, r]));
  // The Morning sheet's added columns, so the combined view keeps them.
  const [morningExtraRows, morningLayout] =
    morningRows.length > 0
      ? await Promise.all([dailyStockExtraRepository.findAllForDate("OFFLINE", entryDate, "MORNING"), sheetExtraColumnRepository.findForSheet("OFFLINE", entryDate, "MORNING")])
      : [[], []];
  const splitDay = morningByProduct.size > 0;

  const missingProductIds = products.filter((p) => !rowByProduct.has(p.id) && !morningByProduct.has(p.id)).map((p) => p.id);
  const openingStockByProduct = await dailyOfflineStockRepository.getOpeningStocksForProducts(missingProductIds, entryDate, splitDay ? "MORNING" : shift);
  // A saved layout naming Delivery (Out) counts too: once the sheet has added
  // Delivery columns, every product's figure must be shown in them. Judged on
  // the row alone, a product with a flat one-slot figure would get a zeroed
  // column from the layout while its total (the sum of those columns) read 0.
  const sheetSplit =
    sheetHasDeliveryBreakdown(rows as unknown as Record<string, unknown>[]) || layoutRows.some((c) => c.columnKey === DELIVERY_COLUMN);

  return products.map((product) => {
    const stored = extrasByProduct.get(product.id) ?? [];
    const existing = rowByProduct.get(product.id);
    if (splitDay && (existing || morningByProduct.has(product.id))) {
      const merged = combineSplitRows(morningByProduct.get(product.id), existing, [
        "stockInOlToOff",
        "stockOutOffToOl",
        "productionIn",
        "deliveryOut",
        "delivery1",
        "delivery2",
        "delivery3",
        "delivery4",
        "delivery5",
        "backloads",
        "upsellOut",
      ])!;
      const figures = merged as unknown as OfflineFigures & { openingStock: number };
      const { offlineStock, remainingStock } = calculate(figures.openingStock, figures);
      // Each added column shows Morning + Night, so the breakdown is not lost
      // to the total when a day entered by shift is viewed as one sheet.
      const morningRow = morningByProduct.get(product.id);
      const morningSplit = sheetHasDeliveryBreakdown(morningRows as unknown as Record<string, unknown>[]) || morningLayout.some((c) => c.columnKey === DELIVERY_COLUMN);
      const morningExtras = [
        ...(morningRow ? deliveryExtrasFromLegacy({ ...morningRow, ...resolveDelivery(morningRow, {}) }, morningSplit) : []),
        ...morningExtraRows.filter((e) => e.productId === product.id),
      ];
      const nightExtras = existing ? [...deliveryExtrasFromLegacy({ ...existing, ...resolveDelivery(existing, {}) }, sheetSplit), ...stored] : [];
      const combinedExtras = sumExtras(morningExtras, nightExtras);
      const combinedLayout = unionLayouts(morningLayout, layoutRows);
      return {
        product,
        entry: { ...merged, shift, offlineStock, remainingStock, ...layoutCellsFor(combinedLayout, combinedExtras, merged as unknown as Record<string, unknown>), ...flattenExtras(combinedExtras), [WHOLE_DAY_COMBINED]: true },
        isSaved: true,
      };
    }
    if (existing) {
      // Delivery (Out)'s first five added columns are the legacy slot columns
      // on this row, not daily_stock_extra rows - so they're read from there
      // and the stored overflow (slots 6+) sits on top.
      // Read the slots as resolved (a row saved before the slots existed holds
      // only its flat total, which resolveDelivery places in slot 1).
      const delivery = resolveDelivery(existing, {});
      const extras = [...deliveryExtrasFromLegacy({ ...existing, ...delivery }, sheetSplit), ...stored];
      return { product, entry: { ...existing, ...delivery, ...layoutCellsFor(layoutRows, extras, { ...existing, ...delivery }), ...flattenExtras(extras) }, isSaved: true };
    }
    const extras = stored;

    const openingStock = openingStockByProduct.get(product.id) ?? 0;
    const zero: OfflineFigures = {
      stockInOlToOff: 0,
      stockOutOffToOl: 0,
      productionIn: 0,
      deliveryOut: 0,
      delivery1: 0,
      delivery2: 0,
      delivery3: 0,
      delivery4: 0,
      delivery5: 0,
      backloads: 0,
      upsellOut: 0,
    };
    const { offlineStock, remainingStock } = calculate(openingStock, zero);
    return {
      product,
      entry: { productId: product.id, entryDate, shift, openingStock, ...zero, offlineStock, remainingStock, ...layout, ...flattenExtras(extras) },
      isSaved: false,
    };
  });
}

/// Encoder-facing upsert for one product/date/shift cell row (Section 4.3).
///
/// Wrapped in one DB transaction together with its Online mirror
/// (mirrorTransferToOnline, below): both upserts and both change-log writes
/// commit or roll back together - see saveOnlineEntry's matching comment
/// (dailyOnlineStock.service.ts) for the partial-commit bug this closes, and
/// for why that transaction is SERIALIZABLE rather than the default
/// REPEATABLE READ (the lost-update race serializableTransaction's own doc
/// comment, lib/prisma.ts, describes), and for how negative stock is handled:
/// it is saved and flagged, never rejected here (see isNegativeStock in
/// utils/stockMath.ts). Later saved periods are re-derived from this row's new
/// Remaining Stock by propagateOpeningStock (manualCounts.service.ts), exactly
/// as on the Online side.
///
/// `db` stays an accepted parameter so related operations can compose this
/// save into a caller-owned transaction without opening a nested transaction.
export async function saveOfflineEntry(
  productId: number,
  entryDate: Date,
  shift: Shift,
  input: OfflineEntryInput,
  userId?: number,
  db?: Db,
): Promise<DailyOfflineStock & { heldForApproval?: HeldTransfer[] }> {
  if (!db) {
    const saved = await serializableTransaction((tx) => saveOfflineEntry(productId, entryDate, shift, input, userId, tx));
    broadcastRealtimeEvent();
    return saved;
  }

  await assertPeriodOpen(entryDate, shift, db, "entry", "OFFLINE");
  await assertEarlierDaysFinished(entryDate, db, "OFFLINE");
  const product = await productRepository.findActiveById(productId, db);
  if (!product) throw HttpError.notFound("Active product not found");
  const existing = await dailyOfflineStockRepository.findByProductAndDate(productId, entryDate, shift, db);

  // A transfer change that would also rewrite the other page, once that page is
  // finished, is held for an admin instead (heldTransfers.service.ts).
  const split = await holdLockedTransfers("OFFLINE", input, existing, entryDate, shift, db);
  const held = split.held;
  input = split.input;
  const withHeld = async <R extends object>(row: R & { id: number }) => {
    if (held.length === 0) return row;
    await requestHeldTransfers("OFFLINE", row.id, held, userId, db);
    return { ...row, heldForApproval: held };
  };

  const extras = input.extras ?? [];
  const extrasError = validateExtras("OFFLINE", extras);
  if (extrasError) throw HttpError.badRequest(extrasError);
  // Recomputed here, not trusted from the request - see the matching comment
  // in dailyOnlineStock.service.ts's saveOnlineEntry.
  const extraTotals = totalsFromExtras(extras);

  const openingStock =
    input.openingStock ?? (existing ? toNum(existing.openingStock) : await computeOpeningStock(productId, entryDate, shift, db));
  // Delivery (Out) resolves from its added columns when it has any (their
  // first five being the legacy slot columns), and otherwise exactly as it
  // always has - a flat figure, typed or imported, landing in slot 1.
  const deliveryExtras = splitDeliveryExtras(extras);
  const resolvedDelivery =
    extraTotals[DELIVERY_COLUMN] === undefined
      ? resolveDelivery(existing, input)
      : { ...deliveryExtras.legacy, deliveryOut: extraTotals[DELIVERY_COLUMN] };
  // "Save total only" on Delivery (Out) collapses the legacy slot columns back
  // into slot 1 as well. Without this the next load would read the stale
  // breakdown off them and re-create the very columns just folded up.
  const clearingDelivery =
    extraTotals[DELIVERY_COLUMN] === undefined && (input.clearExtraColumns ?? []).includes(DELIVERY_COLUMN);
  const delivery = clearingDelivery
    ? { delivery1: resolvedDelivery.deliveryOut, delivery2: 0, delivery3: 0, delivery4: 0, delivery5: 0, deliveryOut: resolvedDelivery.deliveryOut }
    : resolvedDelivery;

  const merged: OfflineFigures = {
    stockInOlToOff: extraTotals.stockInOlToOff ?? input.stockInOlToOff ?? toNum(existing?.stockInOlToOff),
    stockOutOffToOl: extraTotals.stockOutOffToOl ?? input.stockOutOffToOl ?? toNum(existing?.stockOutOffToOl),
    productionIn: extraTotals.productionIn ?? input.productionIn ?? toNum(existing?.productionIn),
    ...(delivery as ReturnType<typeof resolveDelivery>),
    backloads: extraTotals.backloads ?? input.backloads ?? toNum(existing?.backloads),
    upsellOut: extraTotals.upsellOut ?? input.upsellOut ?? toNum(existing?.upsellOut),
  };
  // See saveOnlineEntry: an opening set by an import is flagged, so it is not rewritten.
  const openingManual = input.openingStock !== undefined ? true : (existing?.openingManual ?? false);
  const { offlineStock, remainingStock } = calculate(openingStock, merged);

  // Negative stock is allowed on save: Out figures are often entered before the
  // matching In (production handed in later), and refusing the save leaves the
  // Out unrecorded. The row is flagged negative instead, Finish Day will not lock
  // it without a supervisor's sign-off (dayFinish.service.ts), and the Admin
  // Queue lists it. Remaining Stock is stored as computed.

  if (existing && isNoopSave(existing, openingStock, merged, columnKeysOf(extras).length + (input.clearExtraColumns?.length ?? 0))) {
    return withHeld(existing);
  }

  const data = { productId, entryDate, shift, openingStock, openingManual, ...merged, offlineStock, remainingStock, encodedById: userId };
  const saved = await dailyOfflineStockRepository.upsert(existing?.id, data, db);

  // Columns whose stored amounts this save replaces - see the matching
  // comment in dailyOnlineStock.service.ts's saveOnlineEntry.
  const touchedColumns = [...new Set([...columnKeysOf(extras), ...(input.clearExtraColumns ?? [])])];
  const priorExtras = touchedColumns.length
    ? await dailyStockExtraRepository.findForProduct("OFFLINE", productId, entryDate, shift, db)
    : [];
  // Delivery (Out)'s first five amounts are already saved, as the row's own
  // legacy slot columns - only its overflow becomes daily_stock_extra rows.
  const storedExtras = [
    ...extras.filter((e) => e.columnKey !== DELIVERY_COLUMN),
    ...deliveryExtras.overflow,
  ];
  await dailyStockExtraRepository.replaceColumns("OFFLINE", productId, entryDate, shift, touchedColumns, storedExtras, userId, db);
  await sheetExtraColumnRepository.sync("OFFLINE", entryDate, shift, extras, input.clearExtraColumns ?? [], db);

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

  // Section 4.3 - mirror this transfer back onto the Online table via its
  // repository directly, keeping the two stock services independent of
  // each other (see dailyOnlineStock.service.ts for the reverse direction).
  // Mirrored into the same shift - see that file's own comment for why.
  await mirrorTransferToOnline(
    productId,
    entryDate,
    shift,
    { stockInOffToOl: merged.stockOutOffToOl, stockOutOlToOff: merged.stockInOlToOff },
    userId,
    db,
  );

  // Recompute later saved periods from this corrected balance. The mirrored
  // transfer can also change Online's balance, so propagate both locations
  // in the transaction that saves the two sides.
  await propagateOpeningStock(productId, entryDate, shift, "OFFLINE", userId, db, changeId, { from: "period" });
  await propagateOpeningStock(productId, entryDate, shift, "ONLINE", userId, db, changeId, { from: "period" });

  // Not broadcast here - the `!db` branch above does it once the transaction
  // that wraps this whole function has actually committed. A caller that
  // passes its own `db`/`tx` in (composing this into a larger transaction)
  // owns broadcasting for itself, once ITS transaction commits.
  return withHeld(saved);
}

async function mirrorTransferToOnline(
  productId: number,
  entryDate: Date,
  shift: Shift,
  mirrored: { stockInOffToOl: number; stockOutOlToOff: number },
  userId?: number,
  db: Db = prisma,
) {
  const existing = await dailyOnlineStockRepository.findByProductAndDate(productId, entryDate, shift, db);

  // Same guard as the reverse direction in dailyOnlineStock.service.ts -
  // saveOfflineEntry mirrors unconditionally after every save, so without
  // this check an edit to e.g. Delivery (Out) alone would still rewrite and
  // re-log the online row even though nothing about the transfer changed.
  if (existing && toNum(existing.stockInOffToOl) === mirrored.stockInOffToOl && toNum(existing.stockOutOlToOff) === mirrored.stockOutOlToOff) {
    return;
  }
  if (!existing && mirrored.stockInOffToOl === 0 && mirrored.stockOutOlToOff === 0) {
    return; // nothing has actually transferred yet - don't create a blank row just to mirror zeros
  }

  const openingStock = existing ? toNum(existing.openingStock) : await dailyOnlineStockRepository.getOpeningStock(productId, entryDate, shift, db);

  const merged = {
    stockInOffToOl: mirrored.stockInOffToOl,
    stockOutOlToOff: mirrored.stockOutOlToOff,
    productionIn: toNum(existing?.productionIn),
    fulfillmentOut: toNum(existing?.fulfillmentOut),
    rts: toNum(existing?.rts),
  };
  const onlineStock = calculateOnlineStock(openingStock, merged.stockInOffToOl, merged.stockOutOlToOff);
  const remainingStock = calculateOnlineRemaining(onlineStock, merged.productionIn, merged.fulfillmentOut, merged.rts);

  // Same as the own-side save: a mirrored transfer may leave this side negative.

  const data = {
    productId,
    entryDate,
    shift,
    openingStock,
    ...merged,
    onlineStock,
    remainingStock,
    encodedById: existing?.encodedById ?? userId,
  };
  const saved = await dailyOnlineStockRepository.upsert(existing?.id, data, db);

  await recordChange(
    {
      tableName: ONLINE_TABLE,
      recordId: saved.id,
      action: existing ? "UPDATE" : "CREATE",
      changedById: userId,
      oldValue: existing,
      newValue: saved,
    },
    db,
  );
}
