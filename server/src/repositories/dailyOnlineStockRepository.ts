import { prisma } from "../lib/prisma";
import { toNum } from "../utils/stockMath";

export interface OnlineStockData {
  productId: number;
  entryDate: Date;
  openingStock: number;
  stockInOffToOl: number;
  stockOutOlToOff: number;
  onlineStock: number;
  productionIn: number;
  fulfillmentOut: number;
  rts: number;
  remainingStock: number;
  encodedById?: number;
}

/// Section 5.2 - daily_online_stock: one row per product, per date.
export const dailyOnlineStockRepository = {
  findByProductAndDate(productId: number, entryDate: Date) {
    return prisma.dailyOnlineStock.findUnique({ where: { productId_entryDate: { productId, entryDate } } });
  },

  findAllForDate(entryDate: Date) {
    return prisma.dailyOnlineStock.findMany({ where: { entryDate } });
  },

  /// Section 4.6 - auto carry-forward: the most recent prior date's
  /// Remaining Stocks becomes this date's opening Stocks.
  async getOpeningStock(productId: number, entryDate: Date): Promise<number> {
    const prior = await prisma.dailyOnlineStock.findFirst({
      where: { productId, entryDate: { lt: entryDate } },
      orderBy: { entryDate: "desc" },
      select: { remainingStock: true },
    });
    return toNum(prior?.remainingStock ?? 0);
  },

  /// Batched form of getOpeningStock for an entire grid load. Naively calling
  /// getOpeningStock once per product turns a single grid fetch into up to
  /// ~60 sequential queries (an N+1 pattern) whenever most of that date's
  /// rows haven't been saved yet. This does it in exactly two queries
  /// regardless of how many products are missing: one to find each
  /// product's latest prior date, one to fetch the remainingStock for those
  /// exact (productId, date) pairs.
  async getOpeningStocksForProducts(productIds: number[], entryDate: Date): Promise<Map<number, number>> {
    if (!productIds.length) return new Map();

    const latest = await prisma.dailyOnlineStock.groupBy({
      by: ["productId"],
      where: { productId: { in: productIds }, entryDate: { lt: entryDate } },
      _max: { entryDate: true },
    });
    const pairs = latest.filter((l) => l._max.entryDate).map((l) => ({ productId: l.productId, entryDate: l._max.entryDate as Date }));
    if (!pairs.length) return new Map();

    const rows = await prisma.dailyOnlineStock.findMany({
      where: { OR: pairs.map((p) => ({ productId: p.productId, entryDate: p.entryDate })) },
      select: { productId: true, remainingStock: true },
    });
    return new Map(rows.map((r) => [r.productId, toNum(r.remainingStock)]));
  },

  upsert(id: number | undefined, data: OnlineStockData) {
    return id
      ? prisma.dailyOnlineStock.update({ where: { id }, data })
      : prisma.dailyOnlineStock.create({ data });
  },
};
