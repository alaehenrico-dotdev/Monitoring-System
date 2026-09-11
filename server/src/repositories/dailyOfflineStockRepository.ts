import { prisma } from "../lib/prisma";
import { toNum } from "../utils/stockMath";

export interface OfflineStockData {
  productId: number;
  entryDate: Date;
  openingStock: number;
  stockInOlToOff: number;
  stockOutOffToOl: number;
  offlineStock: number;
  productionIn: number;
  deliveryOut: number;
  backloads: number;
  remainingStock: number;
  encodedById?: number;
}

/// Section 5.3 - daily_offline_stock: one row per product, per date.
export const dailyOfflineStockRepository = {
  findByProductAndDate(productId: number, entryDate: Date) {
    return prisma.dailyOfflineStock.findUnique({ where: { productId_entryDate: { productId, entryDate } } });
  },

  findAllForDate(entryDate: Date) {
    return prisma.dailyOfflineStock.findMany({ where: { entryDate } });
  },

  /// Section 4.6 - same carry-forward principle as the Online table.
  async getOpeningStock(productId: number, entryDate: Date): Promise<number> {
    const prior = await prisma.dailyOfflineStock.findFirst({
      where: { productId, entryDate: { lt: entryDate } },
      orderBy: { entryDate: "desc" },
      select: { remainingStock: true },
    });
    return toNum(prior?.remainingStock ?? 0);
  },

  /// Batched form of getOpeningStock - see dailyOnlineStockRepository's
  /// getOpeningStocksForProducts for why this matters (N+1 avoidance).
  async getOpeningStocksForProducts(productIds: number[], entryDate: Date): Promise<Map<number, number>> {
    if (!productIds.length) return new Map();

    const latest = await prisma.dailyOfflineStock.groupBy({
      by: ["productId"],
      where: { productId: { in: productIds }, entryDate: { lt: entryDate } },
      _max: { entryDate: true },
    });
    const pairs = latest.filter((l) => l._max.entryDate).map((l) => ({ productId: l.productId, entryDate: l._max.entryDate as Date }));
    if (!pairs.length) return new Map();

    const rows = await prisma.dailyOfflineStock.findMany({
      where: { OR: pairs.map((p) => ({ productId: p.productId, entryDate: p.entryDate })) },
      select: { productId: true, remainingStock: true },
    });
    return new Map(rows.map((r) => [r.productId, toNum(r.remainingStock)]));
  },

  upsert(id: number | undefined, data: OfflineStockData) {
    return id
      ? prisma.dailyOfflineStock.update({ where: { id }, data })
      : prisma.dailyOfflineStock.create({ data });
  },
};
