import { StockLocation } from "@prisma/client";
import { prisma } from "../lib/prisma";

export interface ManualCountData {
  productId: number;
  entryDate: Date;
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
}

/// Section 5.4 - manual_counts: physical count capture; variance is derived, never typed.
export const manualCountRepository = {
  findOne(productId: number, entryDate: Date, location: StockLocation) {
    return prisma.manualCount.findUnique({
      where: { productId_entryDate_location: { productId, entryDate, location } },
    });
  },

  findAllForDateAndLocation(entryDate: Date, location: StockLocation) {
    return prisma.manualCount.findMany({ where: { entryDate, location } });
  },

  /// Used by the Total Stocks view (Section 4.5). A saved TOTAL count is the
  /// authoritative combined count; ONLINE/OFFLINE counts remain the fallback.
  findForTotals(entryDate: Date) {
    return prisma.manualCount.findMany({ where: { entryDate, location: { in: ["ONLINE", "OFFLINE", "TOTAL"] } } });
  },

  upsert(id: number | undefined, data: ManualCountData) {
    return id
      ? prisma.manualCount.update({ where: { id }, data })
      : prisma.manualCount.create({ data });
  },

  /// Section 4.8 - Variance Report query, filterable by product/category/location.
  findForVarianceReport(filters: VarianceReportFilters) {
    return prisma.manualCount.findMany({
      where: {
        entryDate: { gte: filters.startDate, lte: filters.endDate },
        productId: filters.productId,
        location: filters.location,
        product: filters.category ? { category: filters.category } : undefined,
      },
      include: { product: true, countedBy: { select: { id: true, name: true, username: true } } },
      orderBy: [{ entryDate: "desc" }, { product: { name: "asc" } }],
    });
  },
};
