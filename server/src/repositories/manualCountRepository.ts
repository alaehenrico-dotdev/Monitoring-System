import { Shift, StockLocation } from "@prisma/client";
import { prisma, type Db } from "../lib/prisma";

export interface ManualCountData {
  productId: number;
  entryDate: Date;
  shift: Shift;
  location: StockLocation;
  systemRemainingStock: number;
  manualCount: number;
  variance: number;
  countedById?: number;
  /// Set to null on every count save: editing a count un-publishes it.
  publishedAt?: Date | null;
  publishedById?: number | null;
}

export interface VarianceReportFilters {
  startDate: Date;
  endDate: Date;
  productId?: number;
  category?: string;
  location?: StockLocation;
  shift?: Shift;
}

/// Section 5.4 - manual_counts: physical count capture; variance is derived, never typed.
export const manualCountRepository = {
  findOne(productId: number, entryDate: Date, shift: Shift, location: StockLocation, db: Db = prisma) {
    return db.manualCount.findUnique({
      where: { productId_entryDate_shift_location: { productId, entryDate, shift, location } },
    });
  },

  /// The most recent saved count strictly before the given period (Morning <
  /// Night within a date). A count is the starting point of the following
  /// period's opening stock whether or not a daily row exists for the
  /// counted period, so this is looked up on its own.
  findLatestBefore(productId: number, entryDate: Date, shift: Shift, location: StockLocation, db: Db = prisma) {
    return db.manualCount.findFirst({
      where: {
        productId,
        location,
        // Only a published count carries forward.
        publishedAt: { not: null },
        OR: shift === "NIGHT" ? [{ entryDate: { lt: entryDate } }, { entryDate, shift: "MORNING" }] : [{ entryDate: { lt: entryDate } }],
      },
      orderBy: [{ entryDate: "desc" }, { shift: "desc" }],
      select: { entryDate: true, shift: true, manualCount: true },
    });
  },

  /// Batched findLatestBefore - one latest count per product.
  findLatestBeforeForProducts(productIds: number[], entryDate: Date, shift: Shift, location: StockLocation) {
    if (!productIds.length) return Promise.resolve([]);
    return prisma.manualCount.findMany({
      where: {
        productId: { in: productIds },
        location,
        publishedAt: { not: null },
        OR: shift === "NIGHT" ? [{ entryDate: { lt: entryDate } }, { entryDate, shift: "MORNING" }] : [{ entryDate: { lt: entryDate } }],
      },
      orderBy: [{ entryDate: "desc" }, { shift: "desc" }],
      distinct: ["productId"],
      select: { productId: true, entryDate: true, shift: true, manualCount: true },
    });
  },

  /// One count with who last saved it - for the Variance details panel.
  findOneWithCounter(productId: number, entryDate: Date, shift: Shift, location: StockLocation, db: Db = prisma) {
    return db.manualCount.findUnique({
      where: { productId_entryDate_shift_location: { productId, entryDate, shift, location } },
      include: { countedBy: { select: { name: true } } },
    });
  },

  /// Remarks are edited on their own: a count save never touches them, and
  /// editing them never touches the figures or the carry-forward.
  updateRemarks(id: number, remarks: string | null, db: Db = prisma) {
    return db.manualCount.update({ where: { id }, data: { remarks } });
  },

  /// Saved counts for one sheet (date + shift, every location) that have not
  /// been published yet - what the Publish button releases.
  findUnpublishedForPeriod(entryDate: Date, shift: Shift, db: Db = prisma) {
    return db.manualCount.findMany({ where: { entryDate, shift, publishedAt: null } });
  },

  markPublished(id: number, userId: number | null, publishedAt: Date, db: Db = prisma) {
    return db.manualCount.update({ where: { id }, data: { publishedAt, publishedById: userId } });
  },

  findAllForDateAndLocation(entryDate: Date, shift: Shift, location: StockLocation) {
    return prisma.manualCount.findMany({ where: { entryDate, shift, location } });
  },

  /// Batched form of findOne, for a set of (productId, entryDate, shift)
  /// keys that don't all share the same date/shift - see
  /// dailyOnlineStockRepository/dailyOfflineStockRepository's
  /// getOpeningStocksForProducts, which resolves each product's own
  /// "immediately preceding period" independently and then needs this one
  /// batched lookup to check all of them for a superseding manual count at
  /// once, rather than one query per product.
  findManyForKeys(keys: { productId: number; entryDate: Date; shift: Shift }[], location: StockLocation) {
    if (!keys.length) return Promise.resolve([]);
    return prisma.manualCount.findMany({
      where: { location, publishedAt: { not: null }, OR: keys.map((k) => ({ productId: k.productId, entryDate: k.entryDate, shift: k.shift })) },
      select: { productId: true, manualCount: true },
    });
  },

  /// Used by the Total Stocks view (Section 4.5), which is a per-date (not
  /// per-shift) snapshot - both shifts saved so far for the date are
  /// returned and totalStocks.service collapses each product/location down
  /// to whichever shift is more recent. A saved TOTAL count is the
  /// authoritative combined count; ONLINE/OFFLINE counts remain the fallback.
  findForTotals(entryDate: Date) {
    return prisma.manualCount.findMany({ where: { entryDate, location: { in: ["ONLINE", "OFFLINE", "TOTAL"] } } });
  },

  upsert(id: number | undefined, data: ManualCountData, db: Db = prisma) {
    return id
      ? db.manualCount.update({ where: { id }, data })
      : db.manualCount.create({ data });
  },

  /// Undoes a CSV import that created a count which didn't exist before (see
  /// manualCounts.service.ts's deleteManualCount) - a plain delete, not an
  /// upsert, since there's no "old value" to restore it to.
  delete(id: number, db: Db = prisma) {
    return db.manualCount.delete({ where: { id } });
  },

  /// Section 4.8 - Variance Report query, filterable by product/category/
  /// location/shift.
  findForVarianceReport(filters: VarianceReportFilters) {
    return prisma.manualCount.findMany({
      where: {
        entryDate: { gte: filters.startDate, lte: filters.endDate },
        productId: filters.productId,
        location: filters.location,
        shift: filters.shift,
        product: filters.category ? { category: filters.category } : undefined,
      },
      include: { product: true, countedBy: { select: { id: true, name: true, username: true } } },
      orderBy: [{ entryDate: "desc" }, { shift: "desc" }, { product: { name: "asc" } }],
    });
  },
};
