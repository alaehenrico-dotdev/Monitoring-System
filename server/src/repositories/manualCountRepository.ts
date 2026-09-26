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
      where: { location, OR: keys.map((k) => ({ productId: k.productId, entryDate: k.entryDate, shift: k.shift })) },
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

  upsert(id: number | undefined, data: ManualCountData) {
    return id
      ? prisma.manualCount.update({ where: { id }, data })
      : prisma.manualCount.create({ data });
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
