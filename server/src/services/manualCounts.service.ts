import { ManualCount, Prisma, Shift, StockLocation } from "@prisma/client";
import { prisma, type Db } from "../lib/prisma";
import { manualCountRepository } from "../repositories/manualCountRepository";
import { dailyOnlineStockRepository } from "../repositories/dailyOnlineStockRepository";
import { dailyOfflineStockRepository } from "../repositories/dailyOfflineStockRepository";
import { productRepository } from "../repositories/productRepository";
import { logSystemEvent, recordChange } from "./changeLog.service";
import { recordReportHistoryIn } from "./reportHistory.service";
import { assertPeriodOpen, isLockedForCarry } from "./dayLock.service";
import { holdStaleOpening } from "./staleOpening.service";
import { broadcastRealtimeEvent } from "../lib/realtime";
import {
  calculateOfflineRemaining,
  calculateOfflineStock,
  calculateOnlineRemaining,
  calculateOnlineStock,
  calculateVariance,
  toNum,
} from "../utils/stockMath";
import { HttpError } from "../utils/HttpError";
import { changeLogRepository } from "../repositories/changeLogRepository";
import { userRepository } from "../repositories/userRepository";
import { diffChanges, summarizeChange } from "../utils/changeSummary";
import { toDateOnlyString } from "../utils/date";

const TABLE = "manual_counts";

/// Section 4.4 - Variance = Manual Count - System Remaining Stock. The system
/// figure is always pulled fresh from the matching daily table (same shift)
/// at save time, never typed, so it can't silently disappear the way an
/// overwritten spreadsheet cell can (Section 2.1).
export async function getSystemRemainingStock(productId: number, entryDate: Date, shift: Shift, location: StockLocation, db: Db = prisma) {
  // No saved row for that date/shift is not 0 stock: the entry pages show it
  // at its carried-forward opening (zero activity => remaining == opening),
  // so the audit's System Remaining must too or variance is measured
  // against 0.
  const onlineRemaining = async () => {
    const row = await dailyOnlineStockRepository.findByProductAndDate(productId, entryDate, shift, db);
    return row ? toNum(row.remainingStock) : toNum(await dailyOnlineStockRepository.getOpeningStock(productId, entryDate, shift, db));
  };
  const offlineRemaining = async () => {
    const row = await dailyOfflineStockRepository.findByProductAndDate(productId, entryDate, shift, db);
    return row ? toNum(row.remainingStock) : toNum(await dailyOfflineStockRepository.getOpeningStock(productId, entryDate, shift, db));
  };
  if (location === "ONLINE") return onlineRemaining();
  if (location === "OFFLINE") return offlineRemaining();
  // TOTAL - Online + Offline remaining stock combined (Section 4.5).
  const [online, offline] = await Promise.all([onlineRemaining(), offlineRemaining()]);
  return online + offline;
}

/// Wrapped in one DB transaction together with propagateOpeningStock's whole
/// forward walk: previously each step (this row's own upsert+log, then every
/// downstream row propagateOpeningStock touches) committed independently, so
/// a failure partway through (a DB hiccup, not a validation rejection - nothing
/// here throws on bad input) could leave the count saved but only some
/// downstream opening stocks re-derived. See saveOnlineEntry's matching
/// comment (dailyOnlineStock.service.ts) for the same class of bug on the
/// stock-entry side.
///
/// `db` stays an accepted parameter so related operations can compose this
/// save into a caller-owned transaction without opening a nested transaction.
export async function saveManualCount(
  productId: number,
  entryDate: Date,
  shift: Shift,
  location: StockLocation,
  manualCount: number,
  userId?: number,
  importBatchId?: number | null,
  db?: Db,
): Promise<ManualCount> {
  if (!db) {
    const saved = await prisma.$transaction((tx) =>
      saveManualCount(productId, entryDate, shift, location, manualCount, userId, importBatchId, tx),
    );
    broadcastRealtimeEvent();
    return saved;
  }

  await assertPeriodOpen(entryDate, shift, db, "count");
  const product = await productRepository.findActiveById(productId, db);
  if (!product) throw HttpError.notFound("Active product not found");
  const systemRemainingStock = await getSystemRemainingStock(productId, entryDate, shift, location, db);

  const existing = await manualCountRepository.findOne(productId, entryDate, shift, location, db);
  // The first count of a product at a location is its opening balance: the
  // system had no history to compare it against, so it seeds the system rather
  // than auditing it. A re-save keeps whatever the row already was, so
  // correcting the opening figure later does not turn it into a variance.
  // (TOTAL is a combined view, never an opening balance of its own.)
  const isOpeningBalance = existing
    ? existing.isOpeningBalance
    : location !== "TOTAL" && !(await manualCountRepository.hasAnyCount(productId, location, db));
  const variance = isOpeningBalance ? 0 : calculateVariance(systemRemainingStock, manualCount);
  // Saving a count (again) takes it back to unpublished: what carries forward
  // must be what a supervisor approved, not something edited since. That is
  // also the approval step for an opening balance.
  const data = { productId, entryDate, shift, location, systemRemainingStock, manualCount, variance, isOpeningBalance, countedById: userId, publishedAt: null, publishedById: null, appliedToOpening: false };
  const saved = await manualCountRepository.upsert(existing?.id, data, db);

  const changeId = await recordChange(
    {
      tableName: TABLE,
      recordId: saved.id,
      action: existing ? "UPDATE" : "CREATE",
      changedById: userId,
      oldValue: existing,
      newValue: saved,
      importBatchId,
    },
    db,
  );

  // A count is an audit only. Only one that was applied to opening stock has
  // anything to undo: saving it again un-publishes it, so the next day's
  // opening goes back to the carried-forward figure.
  if (existing?.appliedToOpening) await propagateOpeningStock(productId, entryDate, shift, location, userId, db, changeId);

  // Not broadcast here - see saveOnlineEntry's matching comment.
  return saved;
}

/// Reverting a CSV import whose row *created* a count that didn't exist
/// before (see importBatch.service.ts's revertImportBatch) - there's no prior
/// value to restore, so the row is removed outright instead of upserted back
/// to something. Still goes through the same change-log + forward-propagation
/// steps a real delete would, so the next period's opening stock is
/// recomputed exactly as if this count had never been entered. Transactional
/// for the same reason saveManualCount is - see its own comment above, which
/// also covers why `db` stays an accepted parameter (importBatch.service.ts's
/// revertImportBatch composes a whole batch's worth of these into one
/// transaction).
export async function deleteManualCount(
  productId: number,
  entryDate: Date,
  shift: Shift,
  location: StockLocation,
  userId?: number,
  db?: Db,
): Promise<boolean> {
  if (!db) {
    const deleted = await prisma.$transaction((tx) => deleteManualCount(productId, entryDate, shift, location, userId, tx));
    if (deleted) broadcastRealtimeEvent();
    return deleted;
  }

  const existing = await manualCountRepository.findOne(productId, entryDate, shift, location, db);
  if (!existing) return false;
  await assertPeriodOpen(entryDate, shift, db, "count");

  await manualCountRepository.delete(existing.id, db);

  const changeId = await recordChange(
    {
      tableName: TABLE,
      recordId: existing.id,
      action: "DELETE",
      changedById: userId,
      oldValue: existing,
      newValue: undefined,
    },
    db,
  );

  if (existing.appliedToOpening) await propagateOpeningStock(productId, entryDate, shift, location, userId, db, changeId);

  // Not broadcast here - see saveOnlineEntry's matching comment
  // (dailyOnlineStock.service.ts).
  return true;
}

export interface PropagateOptions {
  /// Where the walk starts. "day" (the default, for counts) begins past this
  /// date's Night shift: a count opens the next DAY. "period" (entry saves)
  /// begins right after the saved period itself, so a corrected Morning also
  /// re-derives that same day's Night, which opens with Morning's remaining.
  /// An explicit period begins right after that one.
  from?: "day" | "period" | { entryDate: Date; shift: Shift };
  /// A row an admin has just approved: written even though its period is
  /// finished. The walk past it is held again as usual.
  approvedRowId?: number;
}

export type PropagateOutcome = "kept-manual" | "held-locked" | undefined;

/// Section 4.6 - carry-forward of Remaining Stock into the next saved
/// period's opening stock. A next-period row that was already saved has its
/// opening stock stored, so it must be re-derived here or it keeps carrying
/// the old figure. Walks forward row by row: each changed row's new
/// Remaining Stock feeds the one after it, stopping once an opening stock
/// comes out unchanged. Manual counts take part only when applied to opening
/// stock (see getOpeningStock), and only for a row first saved after that
/// count was published: a row saved earlier keeps carrying the chain it was
/// saved in, so a publish never reaches back into days already entered. A
/// counted row's stored system figure and variance are re-derived as it moves.
/// TOTAL counts are informational only.
///
/// A row whose opening was set by an import (openingManual) is never rewritten:
/// the walk stops there and returns "kept-manual" if that row's opening
/// differs from what would have carried into it.
///
/// A row of a FINISHED period is not rewritten either, and the save that
/// reached it does not fail: the walk stops there, files a pending stale-opening
/// request for an admin (staleOpening.service.ts) and returns "held-locked".
/// Approving it continues the walk from that row.
export async function propagateOpeningStock(
  productId: number,
  entryDate: Date,
  shift: Shift,
  location: StockLocation,
  userId: number | undefined,
  db: Db,
  /// The change_log row that started this walk - stamped on every follow-on
  /// row it writes, so they read as consequences of that change.
  causedById?: number,
  opts: PropagateOptions = {},
): Promise<PropagateOutcome> {
  if (location === "TOTAL") return;
  const from = opts.from ?? "day";
  let cursor =
    typeof from === "object" ? { entryDate: from.entryDate, shift: from.shift } : { entryDate, shift: from === "period" ? shift : ("NIGHT" as Shift) };
  for (;;) {
    let nextPeriod: { entryDate: Date; shift: Shift };

    if (location === "ONLINE") {
      const next = await dailyOnlineStockRepository.findNext(productId, cursor.entryDate, cursor.shift, db);
      if (!next) return;
      nextPeriod = { entryDate: next.entryDate, shift: next.shift };
      const openingStock = await dailyOnlineStockRepository.getOpeningStock(productId, next.entryDate, next.shift, db, next.createdAt);
      if (openingStock === toNum(next.openingStock)) return;
      // Already opening at what an applied audit gives it (an earlier publish set it
      // that way): that is a settled starting record, not a drift to undo.
      if (toNum(next.openingStock) === (await dailyOnlineStockRepository.getOpeningStock(productId, next.entryDate, next.shift, db))) return;
      if (next.openingManual) return "kept-manual";
      // A carry-forward must not quietly rewrite a closed day: hold it.
      if (next.id !== opts.approvedRowId && (await isLockedForCarry(next.entryDate, next.shift, "ONLINE", db))) {
        await holdStaleOpening("ONLINE", next, openingStock, userId, db, causedById);
        return "held-locked";
      }
      const onlineStock = calculateOnlineStock(openingStock, toNum(next.stockInOffToOl), toNum(next.stockOutOlToOff));
      const remainingStock = calculateOnlineRemaining(onlineStock, toNum(next.productionIn), toNum(next.fulfillmentOut), toNum(next.rts));
      const updated = await dailyOnlineStockRepository.upsert(
        next.id,
        {
          productId,
          entryDate: next.entryDate,
          shift: next.shift,
          openingStock,
          stockInOffToOl: toNum(next.stockInOffToOl),
          stockOutOlToOff: toNum(next.stockOutOlToOff),
          onlineStock,
          productionIn: toNum(next.productionIn),
          fulfillmentOut: toNum(next.fulfillmentOut),
          rts: toNum(next.rts),
          remainingStock,
          encodedById: next.encodedById ?? undefined,
        },
        db,
      );
      await recordChange(
        { tableName: "daily_online_stock", recordId: updated.id, action: "UPDATE", changedById: userId, oldValue: next, newValue: updated, causedById },
        db,
      );
    } else {
      const next = await dailyOfflineStockRepository.findNext(productId, cursor.entryDate, cursor.shift, db);
      if (!next) return;
      nextPeriod = { entryDate: next.entryDate, shift: next.shift };
      const openingStock = await dailyOfflineStockRepository.getOpeningStock(productId, next.entryDate, next.shift, db, next.createdAt);
      if (openingStock === toNum(next.openingStock)) return;
      // Already opening at what an applied audit gives it (an earlier publish set it
      // that way): that is a settled starting record, not a drift to undo.
      if (toNum(next.openingStock) === (await dailyOfflineStockRepository.getOpeningStock(productId, next.entryDate, next.shift, db))) return;
      if (next.openingManual) return "kept-manual";
      if (next.id !== opts.approvedRowId && (await isLockedForCarry(next.entryDate, next.shift, "OFFLINE", db))) {
        await holdStaleOpening("OFFLINE", next, openingStock, userId, db, causedById);
        return "held-locked";
      }
      const offlineStock = calculateOfflineStock(openingStock, toNum(next.stockInOlToOff), toNum(next.stockOutOffToOl));
      const remainingStock = calculateOfflineRemaining(
        offlineStock,
        toNum(next.productionIn),
        toNum(next.deliveryOut),
        toNum(next.backloads),
        toNum(next.upsellOut)
      );
      const updated = await dailyOfflineStockRepository.upsert(
        next.id,
        {
          productId,
          entryDate: next.entryDate,
          shift: next.shift,
          openingStock,
          stockInOlToOff: toNum(next.stockInOlToOff),
          stockOutOffToOl: toNum(next.stockOutOffToOl),
          offlineStock,
          productionIn: toNum(next.productionIn),
          deliveryOut: toNum(next.deliveryOut),
          backloads: toNum(next.backloads),
          upsellOut: toNum(next.upsellOut),
          remainingStock,
          encodedById: next.encodedById ?? undefined,
        },
        db,
      );
      await recordChange(
        { tableName: "daily_offline_stock", recordId: updated.id, action: "UPDATE", changedById: userId, oldValue: next, newValue: updated, causedById },
        db,
      );
    }

    const ownCount = await manualCountRepository.findOne(productId, nextPeriod.entryDate, nextPeriod.shift, location, db);
    // A count no longer supersedes what carries into its period (it is an
    // audit only), so the walk keeps going past it.
    if (ownCount) {
      // Its system figure just moved, so its stored variance must follow.
      const systemRemainingStock = await getSystemRemainingStock(productId, nextPeriod.entryDate, nextPeriod.shift, location, db);
      const variance = ownCount.isOpeningBalance ? 0 : calculateVariance(systemRemainingStock, toNum(ownCount.manualCount));
      const reDerived = await manualCountRepository.upsert(
        ownCount.id,
        {
          productId,
          entryDate: nextPeriod.entryDate,
          shift: nextPeriod.shift,
          location,
          systemRemainingStock,
          manualCount: toNum(ownCount.manualCount),
          variance,
          countedById: ownCount.countedById ?? undefined,
        },
        db,
      );
      // This moves a saved count's system figure and variance, so it is logged
      // like any other change to that count - it used to happen silently.
      if (toNum(ownCount.systemRemainingStock) !== systemRemainingStock || toNum(ownCount.variance) !== variance) {
        await recordChange(
          { tableName: TABLE, recordId: reDerived.id, action: "UPDATE", changedById: userId, oldValue: ownCount, newValue: reDerived, causedById },
          db,
        );
      }
    }
    cursor = nextPeriod;
  }
}

/// For a TOTAL grid, the naive per-product getSystemRemainingStock call
/// meant up to two extra queries (online + offline) per unsaved product -
/// worse than the online/offline grids' N+1, since it's effectively 2N+1.
/// This batches the daily table(s) this location actually needs into one
/// fetch each, then computes every product's figure from those in-memory
/// maps instead of querying per product.
export async function getManualCountGrid(entryDate: Date, shift: Shift, location: StockLocation) {
  const products = await productRepository.findActive();
  const rows = await manualCountRepository.findAllForDateAndLocation(entryDate, shift, location);
  const rowByProduct = new Map(rows.map((r) => [r.productId, r]));

  const needsOnline = location === "ONLINE" || location === "TOTAL";
  const needsOffline = location === "OFFLINE" || location === "TOTAL";
  const [onlineRows, offlineRows] = await Promise.all([
    needsOnline ? dailyOnlineStockRepository.findAllForDate(entryDate, shift) : Promise.resolve([]),
    needsOffline ? dailyOfflineStockRepository.findAllForDate(entryDate, shift) : Promise.resolve([]),
  ]);
  const onlineByProduct = new Map(onlineRows.map((r) => [r.productId, r]));
  const offlineByProduct = new Map(offlineRows.map((r) => [r.productId, r]));

  // Products with no saved daily row use their carried-forward opening stock
  // (see getSystemRemainingStock) - batched, and skipped when none are missing.
  const missingOnlineIds = needsOnline ? products.filter((p) => !rowByProduct.has(p.id) && !onlineByProduct.has(p.id)).map((p) => p.id) : [];
  const missingOfflineIds = needsOffline ? products.filter((p) => !rowByProduct.has(p.id) && !offlineByProduct.has(p.id)).map((p) => p.id) : [];
  const [carriedOnline, carriedOffline] = await Promise.all([
    missingOnlineIds.length ? dailyOnlineStockRepository.getOpeningStocksForProducts(missingOnlineIds, entryDate, shift) : new Map<number, number>(),
    missingOfflineIds.length ? dailyOfflineStockRepository.getOpeningStocksForProducts(missingOfflineIds, entryDate, shift) : new Map<number, number>(),
  ]);
  const onlineFor = (id: number) => (onlineByProduct.has(id) ? toNum(onlineByProduct.get(id)?.remainingStock) : toNum(carriedOnline.get(id)));
  const offlineFor = (id: number) => (offlineByProduct.has(id) ? toNum(offlineByProduct.get(id)?.remainingStock) : toNum(carriedOffline.get(id)));

  function systemRemainingStockFor(productId: number): number {
    if (location === "ONLINE") return onlineFor(productId);
    if (location === "OFFLINE") return offlineFor(productId);
    return onlineFor(productId) + offlineFor(productId);
  }

  // Continuity: a saved period whose opening stock is not what the previous
  // period carries forward (its closing, or the physical count that replaced
  // it) - only a CSV import can do that, so it is the first place to look when
  // a variance has no obvious cause. Online/Offline grids only (a TOTAL count
  // has no opening of its own).
  // Unsaved rows that would be saved as an opening balance (no count exists
  // yet for the product at this location) - the page labels them up front.
  const countedProductIds = location === "TOTAL" ? new Set<number>() : await manualCountRepository.productIdsWithCounts(location);
  const savedDaily = location === "ONLINE" ? onlineByProduct : location === "OFFLINE" ? offlineByProduct : null;
  // A saved row is judged by the same gate that opened it: an audit published
  // after the row was first saved never counts as what it should have carried.
  const savedAt = new Map<number, Date>(savedDaily ? [...savedDaily].map(([id, row]) => [id, row.createdAt]) : []);
  const expectedOpening =
    savedDaily && savedDaily.size
      ? location === "ONLINE"
        ? await dailyOnlineStockRepository.getOpeningStocksForProducts([...savedDaily.keys()], entryDate, shift, savedAt)
        : await dailyOfflineStockRepository.getOpeningStocksForProducts([...savedDaily.keys()], entryDate, shift, savedAt)
      : new Map<number, number>();
  // A row that already opens at what an applied audit gives it is a settled
  // starting record, not a break - so a row the audit did reach is not flagged.
  const offGate = savedDaily ? [...savedDaily].filter(([id, row]) => expectedOpening.has(id) && toNum(row.openingStock) !== expectedOpening.get(id)).map(([id]) => id) : [];
  const ungatedOpening = offGate.length
    ? location === "ONLINE"
      ? await dailyOnlineStockRepository.getOpeningStocksForProducts(offGate, entryDate, shift)
      : await dailyOfflineStockRepository.getOpeningStocksForProducts(offGate, entryDate, shift)
    : new Map<number, number>();
  const openingBreakFor = (productId: number): { expected: number; actual: number } | null => {
    const saved = savedDaily?.get(productId);
    const expected = expectedOpening.get(productId);
    if (!saved || expected === undefined) return null;
    const actual = toNum(saved.openingStock);
    if (actual === expected || actual === ungatedOpening.get(productId)) return null;
    return { expected, actual };
  };

  return products.map((product) => {
    const existing = rowByProduct.get(product.id);
    const openingBreak = openingBreakFor(product.id);
    if (existing) return { product, entry: existing, isSaved: true, isFlagged: Number(existing.variance) !== 0, openingBreak };

    const systemRemainingStock = systemRemainingStockFor(product.id);
    return {
      product,
      entry: {
        productId: product.id,
        entryDate,
        shift,
        location,
        systemRemainingStock,
        manualCount: null,
        variance: null,
        isOpeningBalance: location !== "TOTAL" && !countedProductIds.has(product.id),
      },
      isSaved: false,
      isFlagged: false,
      openingBreak,
    };
  });
}

/// Section 4.8 - Variance Report, filterable by product/category/location/
/// shift, across a date range, to spot recurring problem SKUs (Toyo Mansi,
/// Oyster Sauce A per Section 4.4).
export async function getVarianceReport(filters: {
  startDate: Date;
  endDate: Date;
  productId?: number;
  category?: string;
  location?: StockLocation;
  shift?: Shift;
  flaggedOnly?: boolean;
}) {
  if (filters.startDate > filters.endDate) throw HttpError.badRequest("startDate must be before endDate");
  if (filters.endDate.getTime() - filters.startDate.getTime() > MAX_VARIANCE_RANGE_DAYS * 24 * 60 * 60 * 1000) {
    throw HttpError.badRequest(`Choose a range of at most ${MAX_VARIANCE_RANGE_DAYS} days`);
  }

  const rows = await manualCountRepository.findForVarianceReport(filters);
  return filters.flaggedOnly === false ? rows : rows.filter((r) => Number(r.variance) !== 0);
}

export const MAX_REMARKS_LENGTH = 500;

/**
 * Publishes a sheet's counts (one date + shift, every location): the
 * supervisor's sign-off that the counts are final for reporting. Counts are an
 * audit only unless `applyToOpening` is set, in which case each ONLINE/OFFLINE
 * count becomes a fresh starting record: the first period entered after it
 * opens at the counted figure, and every period after that carries on from its
 * own remaining stock, until another count is applied. Periods that were
 * already saved when it is published keep their figures - nothing is rewritten
 * (`leftSaved` says how many products have saved days after the counted one).
 * Variance is untouched: it is still the count against the system's remaining
 * stock on the counted day. Each publish is logged against the count.
 */
export async function publishManualCounts(entryDate: Date, shift: Shift, userId?: number, applyToOpening = false) {
  const result = await prisma.$transaction(
    async (tx) => {
      const pending = await manualCountRepository.findUnpublishedForPeriod(entryDate, shift, tx);
      if (pending.length === 0) throw HttpError.badRequest("There are no saved counts waiting to be published for this shift");

      const now = new Date();
      const idsFor = (location: StockLocation) => pending.filter((c) => c.location === location).map((c) => c.productId);
      // Only to report how many already have later days saved - they are left alone.
      const [onlineHasLater, offlineHasLater] = applyToOpening
        ? await Promise.all([
            dailyOnlineStockRepository.productIdsWithRowsAfterDate(idsFor("ONLINE"), entryDate, tx),
            dailyOfflineStockRepository.productIdsWithRowsAfterDate(idsFor("OFFLINE"), entryDate, tx),
          ])
        : [new Set<number>(), new Set<number>()];
      let leftSaved = 0;
      const releasedCounts: ManualCount[] = [];
      for (const count of pending) {
        // TOTAL is a combined view and can never be split into an opening.
        const apply = applyToOpening && count.location !== "TOTAL";
        const published = await manualCountRepository.markPublished(count.id, userId ?? null, now, apply, tx);
        releasedCounts.push(published);
        await recordChange(
          { tableName: TABLE, recordId: count.id, action: "UPDATE", changedById: userId, oldValue: count, newValue: published },
          tx,
        );
        const hasLater = count.location === "ONLINE" ? onlineHasLater : offlineHasLater;
        if (apply && hasLater.has(count.productId)) leftSaved++;
      }
      // Every publish leaves a frozen copy and an Audit History entry, whether or
      // not the counts were applied to the next day's opening stock.
      const snapshotId = await saveAuditSnapshot(entryDate, shift, now, releasedCounts, applyToOpening, userId, tx);
      return { published: pending.length, publishedAt: now, appliedToOpening: applyToOpening, leftSaved, snapshotId };
    },
    { timeout: 120_000, maxWait: 10_000 },
  );
  broadcastRealtimeEvent();
  return result;
}
/// One row of a published audit, as it was released.
export interface AuditSnapshotRow {
  location: StockLocation;
  productId: number;
  sku: string | null;
  name: string;
  category: string;
  systemRemainingStock: number;
  manualCount: number;
  variance: number;
  isOpeningBalance: boolean;
  remarks: string | null;
}

/// Stores what a publish released and files it in Audit History, inside the
/// publish's own transaction: the history entry cannot exist without the copy it
/// opens, and a failed publish leaves neither.
async function saveAuditSnapshot(entryDate: Date, shift: Shift, publishedAt: Date, counts: ManualCount[], appliedToOpening: boolean, userId: number | undefined, tx: Db) {
  const products = await tx.product.findMany({
    where: { id: { in: [...new Set(counts.map((c) => c.productId))] } },
    select: { id: true, sku: true, name: true, category: true },
  });
  const byId = new Map(products.map((p) => [p.id, p]));
  const rows: AuditSnapshotRow[] = counts.map((c) => ({
    location: c.location,
    productId: c.productId,
    sku: byId.get(c.productId)?.sku ?? null,
    name: byId.get(c.productId)?.name ?? `#${c.productId}`,
    category: byId.get(c.productId)?.category ?? "",
    systemRemainingStock: toNum(c.systemRemainingStock),
    manualCount: toNum(c.manualCount),
    variance: toNum(c.variance),
    isOpeningBalance: c.isOpeningBalance,
    remarks: c.remarks ?? null,
  }));
  const snapshot = await tx.auditSnapshot.create({
    data: { entryDate, shift, publishedAt, publishedById: userId ?? null, appliedToOpening, payload: { rows } as unknown as Prisma.InputJsonValue },
  });
  await recordReportHistoryIn(
    tx,
    { type: "Audit Report", scope: toDateOnlyString(entryDate), route: `/manual-count?history=1&snapshot=${snapshot.id}&date=${toDateOnlyString(entryDate)}&shift=${shift}&source=TOTAL`, section: "all" },
    userId,
  );
  return snapshot.id;
}

/// A published audit exactly as it was released (Audit History). Open to every
/// role that can open the Audit page, like the Audit Report history itself.
export async function getAuditSnapshot(id: number) {
  const snapshot = await prisma.auditSnapshot.findUnique({ where: { id } });
  if (!snapshot) throw HttpError.notFound("That published audit no longer exists");
  const payload = snapshot.payload as unknown as { rows?: AuditSnapshotRow[] };
  return {
    id: snapshot.id,
    entryDate: toDateOnlyString(snapshot.entryDate),
    shift: snapshot.shift,
    publishedAt: snapshot.publishedAt.toISOString(),
    appliedToOpening: snapshot.appliedToOpening,
    revertedAt: snapshot.revertedAt ? snapshot.revertedAt.toISOString() : null,
    rows: payload.rows ?? [],
  };
}

export const MAX_SNAPSHOT_STATES = 100;

/// Where each published audit stands, for the Audit History rows: reverted, and
/// whether it can still be reverted - that is, the sheet's counts still carry
/// THIS publish's timestamp. Editing a count un-publishes it, so an audit that
/// was edited (or re-published) since has nothing left to revert.
export async function getAuditSnapshotStates(ids: number[]) {
  const wanted = [...new Set(ids)].slice(0, MAX_SNAPSHOT_STATES);
  if (wanted.length === 0) return [];
  const snaps = await prisma.auditSnapshot.findMany({
    where: { id: { in: wanted } },
    select: { id: true, entryDate: true, shift: true, publishedAt: true, revertedAt: true, revertedById: true },
  });
  const open = snaps.filter((s) => !s.revertedAt);
  const live = open.length
    ? await prisma.manualCount.findMany({
        where: { OR: open.map((s) => ({ entryDate: s.entryDate, shift: s.shift, publishedAt: s.publishedAt })) },
        select: { entryDate: true, shift: true, publishedAt: true },
        distinct: ["entryDate", "shift", "publishedAt"],
      })
    : [];
  const key = (d: Date, shift: string, at: Date | null) => `${toDateOnlyString(d)}:${shift}:${at ? at.getTime() : ""}`;
  const stillPublished = new Set(live.map((c) => key(c.entryDate, c.shift, c.publishedAt)));
  return snaps.map((s) => ({
    id: s.id,
    reverted: !!s.revertedAt,
    revertedAt: s.revertedAt ? s.revertedAt.toISOString() : null,
    canRevert: !s.revertedAt && stillPublished.has(key(s.entryDate, s.shift, s.publishedAt)),
  }));
}

/**
 * Reverts a published audit so it can be re-audited: every count that this
 * publish released goes back to unpublished (the same state saving a count
 * leaves it in). A count that had been applied to the next day's opening stock
 * has that undone, re-deriving the later periods exactly as a re-save would.
 * Refused for a finished or closed period (unlock it first). The frozen copy
 * and its Audit History entry stay, marked as reverted with the reason, and the
 * counts' own change log shows each step. Everything or nothing, in one transaction.
 */
export async function revertAuditSnapshot(id: number, reason: string, userId?: number) {
  const why = reason.trim();
  if (why.length < 5) throw HttpError.badRequest("Give a reason (at least 5 characters)");
  if (why.length > MAX_REMARKS_LENGTH) throw HttpError.badRequest(`The reason is at most ${MAX_REMARKS_LENGTH} characters`);

  const result = await prisma.$transaction(
    async (tx) => {
      const snapshot = await tx.auditSnapshot.findUnique({ where: { id } });
      if (!snapshot) throw HttpError.notFound("That published audit no longer exists");
      if (snapshot.revertedAt) throw HttpError.conflict("That published audit was already reverted.");
      await assertPeriodOpen(snapshot.entryDate, snapshot.shift, tx, "count");

      const counts = await tx.manualCount.findMany({
        where: { entryDate: snapshot.entryDate, shift: snapshot.shift, publishedAt: snapshot.publishedAt },
      });
      let keptManual = 0;
      let heldLocked = 0;
      for (const count of counts) {
        const updated = await tx.manualCount.update({
          where: { id: count.id },
          data: { publishedAt: null, publishedById: null, appliedToOpening: false },
        });
        const changeId = await recordChange(
          { tableName: TABLE, recordId: count.id, action: "UPDATE", changedById: userId, oldValue: count, newValue: updated },
          tx,
        );
        if (count.appliedToOpening && count.location !== "TOTAL") {
          const outcome = await propagateOpeningStock(count.productId, snapshot.entryDate, snapshot.shift, count.location, userId, tx, changeId);
          if (outcome === "kept-manual") keptManual++;
          if (outcome === "held-locked") heldLocked++;
        }
      }
      await tx.auditSnapshot.update({
        where: { id },
        data: { revertedAt: new Date(), revertedById: userId ?? null, revertReason: why },
      });
      return { snapshotId: id, reverted: counts.length, keptManual, heldLocked, entryDate: snapshot.entryDate, shift: snapshot.shift };
    },
    { timeout: 120_000, maxWait: 10_000 },
  );
  await logSystemEvent(
    "audit_revert",
    { snapshotId: id, date: toDateOnlyString(result.entryDate), shift: result.shift, counts: result.reverted, reason: why },
    userId ?? null,
    "UPDATE",
  );
  broadcastRealtimeEvent();
  return { snapshotId: id, reverted: result.reverted, keptManual: result.keptManual, heldLocked: result.heldLocked };
}

/// Longest period the Variance Report / Ledger will read in one request.
const MAX_VARIANCE_RANGE_DAYS = 366;

/// Sets (or, with an empty string/null, clears) the reason on a SAVED count.
/// Logged like any other change to the count. No-op (and no log row) when the
/// text is unchanged.
export async function setCountRemarks(
  productId: number,
  entryDate: Date,
  shift: Shift,
  location: StockLocation,
  remarks: string | null,
  userId?: number,
): Promise<ManualCount> {
  const text = remarks?.trim() ? remarks.trim() : null;
  if (text !== null && text.length > MAX_REMARKS_LENGTH) throw HttpError.badRequest(`Remarks can be at most ${MAX_REMARKS_LENGTH} characters`);

  const saved = await prisma.$transaction(async (tx) => {
    const existing = await manualCountRepository.findOne(productId, entryDate, shift, location, tx);
    if (!existing) throw HttpError.notFound("Save the count first - remarks explain a saved count");
    if ((existing.remarks ?? null) === text) return existing;
    const updated = await manualCountRepository.updateRemarks(existing.id, text, tx);
    await recordChange({ tableName: TABLE, recordId: existing.id, action: "UPDATE", changedById: userId, oldValue: existing, newValue: updated }, tx);
    return updated;
  });
  broadcastRealtimeEvent();
  return saved;
}

function previousPeriod(entryDate: Date, shift: Shift): { entryDate: Date; shift: Shift } {
  return shift === "NIGHT"
    ? { entryDate, shift: "MORNING" }
    : { entryDate: new Date(entryDate.getTime() - 24 * 60 * 60 * 1000), shift: "NIGHT" };
}

export interface VarianceTraceItem {
  at: Date;
  who: string | null;
  /// "Count" = the manual count itself, "Entry" = the stock entry behind the system figure.
  what: "Count" | "Entry";
  action: "CREATE" | "UPDATE" | "DELETE";
  summary: string;
  /// Made by the system as a consequence of another change (carry-forward),
  /// not by the person named.
  auto: boolean;
  /// An entry edit made after the count was last saved - the usual reason a
  /// count no longer lines up with the sheet it was measured against.
  afterCount: boolean;
}

/**
 * Everything behind one count's variance, so "why is this off, and who touched
 * it" can be answered from one place: the count and its counter, where the
 * period's opening stock came from (and whether it broke the carry-forward),
 * the movements that make up the system figure, and the change history of
 * both the entry and the count (who, when, whether after the count, whether
 * automatic).
 */
export async function getVarianceTrace(productId: number, entryDate: Date, shift: Shift, location: "ONLINE" | "OFFLINE") {
  const product = await productRepository.findActiveById(productId);
  if (!product) throw HttpError.notFound("Active product not found");

  const [count, entry] = await Promise.all([
    manualCountRepository.findOneWithCounter(productId, entryDate, shift, location),
    location === "ONLINE"
      ? dailyOnlineStockRepository.findByProductAndDate(productId, entryDate, shift)
      : dailyOfflineStockRepository.findByProductAndDate(productId, entryDate, shift),
  ]);

  // Judged by the same gate that opened it: an audit published after this row
  // was first saved never counts as what it should have carried.
  const openingFor = (rowCreatedAt?: Date) =>
    location === "ONLINE"
      ? dailyOnlineStockRepository.getOpeningStock(productId, entryDate, shift, undefined, rowCreatedAt)
      : dailyOfflineStockRepository.getOpeningStock(productId, entryDate, shift, undefined, rowCreatedAt);
  let expectedOpening = await openingFor(entry?.createdAt);
  // A row that already opens at what an applied audit gives it (an earlier publish
  // set it that way) is a settled starting record, not a break.
  let followsAudit = false;
  if (entry && toNum(entry.openingStock) !== expectedOpening) {
    const ungated = await openingFor();
    if (ungated === toNum(entry.openingStock)) {
      expectedOpening = ungated;
      followsAudit = true;
    }
  }
  const actualOpening = entry ? toNum(entry.openingStock) : expectedOpening;
  // Only a count applied to opening stock is ever the source; otherwise it is
  // the system carry (or what an import set over it - that shows as isBreak).
  const prior = previousPeriod(entryDate, shift);
  const latestCount = await manualCountRepository.findLatestBefore(productId, entryDate, location, undefined, followsAudit ? undefined : entry?.createdAt);
  // An applied count is the day's closing figure, whichever shift it was taken
  // in, so it is the source when it falls on the day the previous period is on.
  const source = latestCount && toDateOnlyString(latestCount.entryDate) === toDateOnlyString(prior.entryDate) ? "count" : "system";

  const entryTable = location === "ONLINE" ? "daily_online_stock" : "daily_offline_stock";
  const [entryLog, countLog] = await Promise.all([
    entry ? changeLogRepository.findForRecord(entryTable, entry.id, 100) : Promise.resolve([]),
    count ? changeLogRepository.findForRecord(TABLE, count.id, 100) : Promise.resolve([]),
  ]);

  // "After the count" is measured from the last time a PERSON saved it, not
  // from an automatic re-derive of its figures.
  const countedAt = countLog.find((e) => e.causedById === null && e.action !== "DELETE")?.changedAt ?? count?.updatedAt ?? null;

  const history: VarianceTraceItem[] = [
    ...entryLog.map((e) => ({
      at: e.changedAt,
      who: e.changedBy?.name ?? null,
      what: "Entry" as const,
      action: e.action,
      summary: summarizeChange(e.action, e.oldValue, e.newValue),
      auto: e.causedById !== null,
      afterCount: countedAt !== null && e.changedAt > countedAt,
    })),
    ...countLog.map((e) => ({
      at: e.changedAt,
      who: e.changedBy?.name ?? null,
      what: "Count" as const,
      action: e.action,
      summary: summarizeChange(e.action, e.oldValue, e.newValue),
      auto: e.causedById !== null,
      afterCount: false,
    })),
  ].sort((a, b) => b.at.getTime() - a.at.getTime());

  const encodedBy = entry?.encodedById ? ((await userRepository.findById(entry.encodedById))?.name ?? null) : null;

  return {
    product: { id: product.id, sku: product.sku, name: product.name },
    location,
    entryDate: toDateOnlyString(entryDate),
    shift,
    count: count
      ? {
          manualCount: toNum(count.manualCount),
          systemRemainingStock: toNum(count.systemRemainingStock),
          variance: toNum(count.variance),
          remarks: count.remarks,
          countedBy: count.countedBy?.name ?? null,
          countedAt,
          publishedAt: count.publishedAt,
        }
      : null,
    opening: { expected: expectedOpening, actual: actualOpening, isBreak: actualOpening !== expectedOpening, source },
    entrySaved: !!entry,
    encodedBy,
    figures: entry
      ? diffChanges(null, entry)
          .filter((c) => c.after !== "0" && c.after !== "—" && c.key !== "encodedById")
          .map((c) => ({ label: c.label, value: c.after }))
      : [],
    history,
  };
}
