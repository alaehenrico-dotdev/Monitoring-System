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
  isOpeningBalance?: boolean;
  /// Cleared on every count save, like publishedAt.
  appliedToOpening?: boolean;
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

  /// The most recent count strictly before the given date that a supervisor
  /// applied to opening stock when publishing it (counts are otherwise an audit
  /// only). It is looked up on its own because it applies whether or not a
  /// daily row exists for the counted period.
  ///
  /// An applied count is a fresh starting record: whichever shift the next
  /// period turns out to be, it opens from this figure unless a saved row sits
  /// between the count and it (the caller compares the two).
  ///
  /// `rowCreatedAt`, when given, hides every count published AFTER that row was
  /// first saved. Only the ordinary carry-forward walk passes it (an entry save
  /// must not move a chain it did not touch). Publishing a count (a re-audit)
  /// passes nothing, so the new count reaches days already saved - the policy
  /// lives in propagateOpeningStock (manualCounts.service.ts).
  ///
  /// Matches counts strictly before the target DATE, on either shift: a count
  /// opens the next day (KNOWN GAP for MORNING counts - see
  /// dailyOnlineStockRepository.getOpeningStock).
  findLatestBefore(productId: number, entryDate: Date, location: StockLocation, db: Db = prisma, rowCreatedAt?: Date) {
    return db.manualCount.findFirst({
      where: {
        productId,
        location,
        // Only a published count that was applied to opening stock.
        publishedAt: rowCreatedAt ? { not: null, lte: rowCreatedAt } : { not: null },
        appliedToOpening: true,
        entryDate: { lt: entryDate },
      },
      orderBy: [{ entryDate: "desc" }, { shift: "desc" }],
      select: { entryDate: true, shift: true, manualCount: true },
    });
  },

  /// Batched findLatestBefore - one latest count per product. `createdAtByProduct`
  /// carries the saved row's first-save time for the products that already have
  /// one (see findLatestBefore); the rest read the latest applied count.
  async findLatestBeforeForProducts(
    productIds: number[],
    entryDate: Date,
    location: StockLocation,
    createdAtByProduct?: Map<number, Date>,
  ) {
    if (!productIds.length) return [];
    const where = {
      productId: { in: productIds },
      location,
      publishedAt: { not: null },
      appliedToOpening: true,
      entryDate: { lt: entryDate },
    };
    const orderBy = [{ entryDate: "desc" as const }, { shift: "desc" as const }];
    if (!createdAtByProduct?.size) {
      return prisma.manualCount.findMany({
        where,
        orderBy,
        distinct: ["productId"],
        select: { productId: true, entryDate: true, shift: true, manualCount: true },
      });
    }
    const all = await prisma.manualCount.findMany({
      where,
      orderBy,
      select: { productId: true, entryDate: true, shift: true, manualCount: true, publishedAt: true },
    });
    // Newest first, so the first one that qualifies per product is the latest.
    const picked = new Map<number, (typeof all)[number]>();
    for (const c of all) {
      if (picked.has(c.productId)) continue;
      const savedAt = createdAtByProduct.get(c.productId);
      if (savedAt && c.publishedAt && c.publishedAt.getTime() > savedAt.getTime()) continue;
      picked.set(c.productId, c);
    }
    return [...picked.values()].map(({ publishedAt: _publishedAt, ...rest }) => rest);
  },

  /// True when any count at all exists for the product at this location. The
  /// first one is its opening balance (see saveManualCount).
  async hasAnyCount(productId: number, location: StockLocation, db: Db = prisma) {
    return (await db.manualCount.findFirst({ where: { productId, location }, select: { id: true } })) !== null;
  },

  /// Products that already have a count at this location - so a grid can tell
  /// which unsaved rows would be saved as an opening balance.
  async productIdsWithCounts(location: StockLocation) {
    const rows = await prisma.manualCount.groupBy({ by: ["productId"], where: { location } });
    return new Set(rows.map((r) => r.productId));
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

  markPublished(id: number, userId: number | null, publishedAt: Date, appliedToOpening: boolean, db: Db = prisma) {
    return db.manualCount.update({ where: { id }, data: { publishedAt, publishedById: userId, appliedToOpening } });
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

  /// Every audit count saved for a date - all shifts and locations, with the
  /// product - for the Daily Report's Audit section.
  findAllForDateWithProduct(entryDate: Date) {
    return prisma.manualCount.findMany({
      where: { entryDate },
      include: { product: { select: { category: true, sku: true, name: true, sortOrder: true } } },
      orderBy: [{ shift: "asc" }, { location: "asc" }, { product: { sortOrder: "asc" } }, { product: { name: "asc" } }],
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
        // An opening balance seeds the system; it is not an audit result.
        isOpeningBalance: false,
        productId: filters.productId,
        location: filters.location,
        shift: filters.shift,
        product: filters.category ? { category: filters.category } : undefined,
      },
      include: { product: true, countedBy: { select: { id: true, name: true, username: true } } },
      orderBy: [{ entryDate: "desc" }, { shift: "desc" }, { product: { sortOrder: "asc" } }, { product: { name: "asc" } }],
    });
  },
};
