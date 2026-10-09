import { ManualCount, Shift, StockLocation } from "@prisma/client";
import { prisma, type Db } from "../lib/prisma";
import { manualCountRepository } from "../repositories/manualCountRepository";
import { dailyOnlineStockRepository } from "../repositories/dailyOnlineStockRepository";
import { dailyOfflineStockRepository } from "../repositories/dailyOfflineStockRepository";
import { productRepository } from "../repositories/productRepository";
import { recordChange } from "./changeLog.service";
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

/// Section 4.4 - Variance = System Remaining Stock - Manual Count. The system
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

  const product = await productRepository.findActiveById(productId, db);
  if (!product) throw HttpError.notFound("Active product not found");
  const systemRemainingStock = await getSystemRemainingStock(productId, entryDate, shift, location, db);
  const variance = calculateVariance(systemRemainingStock, manualCount);

  const existing = await manualCountRepository.findOne(productId, entryDate, shift, location, db);
  // Saving a count (again) takes it back to unpublished: what carries forward
  // must be what a supervisor approved, not something edited since.
  const data = { productId, entryDate, shift, location, systemRemainingStock, manualCount, variance, countedById: userId, publishedAt: null, publishedById: null };
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

  await propagateOpeningStock(productId, entryDate, shift, location, userId, db, changeId);

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

  await propagateOpeningStock(productId, entryDate, shift, location, userId, db, changeId);
  // Not broadcast here - see saveOnlineEntry's matching comment
  // (dailyOnlineStock.service.ts).
  return true;
}

/// Section 4.4/4.6 - a manual count is the starting point of the next
/// period's opening stock. A next-period row that was already saved has its
/// opening stock stored, so it must be re-derived here or it keeps carrying
/// the old system figure. Walks forward row by row: each changed row's new
/// Remaining Stock feeds the one after it, stopping once an opening stock
/// comes out unchanged or a row has its own manual count for this location
/// (which supersedes whatever carries into it). TOTAL counts are informational
/// only - they can't be split back into Online/Offline balances.
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
) {
  if (location === "TOTAL") return;
  let cursor = { entryDate, shift };
  for (;;) {
    let nextPeriod: { entryDate: Date; shift: Shift };

    if (location === "ONLINE") {
      const next = await dailyOnlineStockRepository.findNext(productId, cursor.entryDate, cursor.shift, db);
      if (!next) return;
      nextPeriod = { entryDate: next.entryDate, shift: next.shift };
      const openingStock = await dailyOnlineStockRepository.getOpeningStock(productId, next.entryDate, next.shift, db);
      if (openingStock === toNum(next.openingStock)) return;
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
      const openingStock = await dailyOfflineStockRepository.getOpeningStock(productId, next.entryDate, next.shift, db);
      if (openingStock === toNum(next.openingStock)) return;
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
    if (ownCount) {
      // Its system figure just moved, so its stored variance must follow.
      const systemRemainingStock = await getSystemRemainingStock(productId, nextPeriod.entryDate, nextPeriod.shift, location, db);
      const variance = calculateVariance(systemRemainingStock, toNum(ownCount.manualCount));
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
      return;
    }
    cursor = nextPeriod;
  }
}

/// Rows saved before a count was imported (or before counts carried forward
/// at all) still hold the stale opening stock they captured. On grid load,
/// re-derive any saved row whose opening should have started from a manual
/// count but doesn't. Only that case is touched - an opening stock seeded by
/// a CSV import with nothing (or no count) before it is left alone.
export async function healOpeningStocks(location: "ONLINE" | "OFFLINE", entryDate: Date, shift: Shift, userId?: number) {
  const rows =
    location === "ONLINE"
      ? await dailyOnlineStockRepository.findAllForDate(entryDate, shift)
      : await dailyOfflineStockRepository.findAllForDate(entryDate, shift);
  if (!rows.length) return;
  const ids = rows.map((r) => r.productId);
  const [expected, counts] = await Promise.all([
    location === "ONLINE"
      ? dailyOnlineStockRepository.getOpeningStocksForProducts(ids, entryDate, shift)
      : dailyOfflineStockRepository.getOpeningStocksForProducts(ids, entryDate, shift),
    manualCountRepository.findLatestBeforeForProducts(ids, entryDate, shift, location),
  ]);
  const countByProduct = new Map(counts.map((c) => [c.productId, toNum(c.manualCount)]));
  const before =
    shift === "NIGHT"
      ? { entryDate, shift: "MORNING" as Shift }
      : { entryDate: new Date(entryDate.getTime() - 24 * 60 * 60 * 1000), shift: "NIGHT" as Shift };
  let changed = false;
  for (const row of rows) {
    const want = expected.get(row.productId);
    if (want === undefined || countByProduct.get(row.productId) !== want) continue;
    if (want === toNum(row.openingStock)) continue;
    await prisma.$transaction((tx) => propagateOpeningStock(row.productId, before.entryDate, before.shift, location, userId, tx));
    changed = true;
  }
  if (changed) broadcastRealtimeEvent();
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
  const savedDaily = location === "ONLINE" ? onlineByProduct : location === "OFFLINE" ? offlineByProduct : null;
  const expectedOpening =
    savedDaily && savedDaily.size
      ? location === "ONLINE"
        ? await dailyOnlineStockRepository.getOpeningStocksForProducts([...savedDaily.keys()], entryDate, shift)
        : await dailyOfflineStockRepository.getOpeningStocksForProducts([...savedDaily.keys()], entryDate, shift)
      : new Map<number, number>();
  const openingBreakFor = (productId: number): { expected: number; actual: number } | null => {
    const saved = savedDaily?.get(productId);
    const expected = expectedOpening.get(productId);
    if (!saved || expected === undefined) return null;
    const actual = toNum(saved.openingStock);
    return actual === expected ? null : { expected, actual };
  };

  return products.map((product) => {
    const existing = rowByProduct.get(product.id);
    const openingBreak = openingBreakFor(product.id);
    if (existing) return { product, entry: existing, isSaved: true, isFlagged: Number(existing.variance) !== 0, openingBreak };

    const systemRemainingStock = systemRemainingStockFor(product.id);
    return {
      product,
      entry: { productId: product.id, entryDate, shift, location, systemRemainingStock, manualCount: null, variance: null },
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
 * Publishes a sheet's counts (one date + shift, every location): from now on
 * each one is the opening stock of the next period, and the periods already
 * saved after it are re-derived from it straight away. Until then a saved
 * count is a figure under review and the next period opens from the system
 * stock as before. Each publish is logged against the count, and the
 * re-derived rows name that log line as their cause.
 */
export async function publishManualCounts(entryDate: Date, shift: Shift, userId?: number) {
  const result = await prisma.$transaction(
    async (tx) => {
      const pending = await manualCountRepository.findUnpublishedForPeriod(entryDate, shift, tx);
      if (pending.length === 0) throw HttpError.badRequest("There are no saved counts waiting to be published for this shift");

      const now = new Date();
      for (const count of pending) {
        const published = await manualCountRepository.markPublished(count.id, userId ?? null, now, tx);
        const changeId = await recordChange(
          { tableName: TABLE, recordId: count.id, action: "UPDATE", changedById: userId, oldValue: count, newValue: published },
          tx,
        );
        await propagateOpeningStock(count.productId, entryDate, shift, count.location, userId, tx, changeId);
      }
      return { published: pending.length, publishedAt: now };
    },
    // A whole sheet is hundreds of rows, each re-deriving what follows it.
    { timeout: 120_000, maxWait: 10_000 },
  );
  broadcastRealtimeEvent();
  return result;
}
/// Longest period the Variance Report / Ledger will read in one request.
export const MAX_VARIANCE_RANGE_DAYS = 366;

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

function previousPeriod(entryDate: Date, shift: Shift): { entryDate: Date; shift: Shift } {
  return shift === "NIGHT"
    ? { entryDate, shift: "MORNING" }
    : { entryDate: new Date(entryDate.getTime() - 24 * 60 * 60 * 1000), shift: "NIGHT" };
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

  const expectedOpening =
    location === "ONLINE"
      ? await dailyOnlineStockRepository.getOpeningStock(productId, entryDate, shift)
      : await dailyOfflineStockRepository.getOpeningStock(productId, entryDate, shift);
  const actualOpening = entry ? toNum(entry.openingStock) : expectedOpening;
  const prior = previousPeriod(entryDate, shift);
  const latestCount = await manualCountRepository.findLatestBefore(productId, entryDate, shift, location);
  const source =
    latestCount && toDateOnlyString(latestCount.entryDate) === toDateOnlyString(prior.entryDate) && latestCount.shift === prior.shift ? "count" : "system";

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
