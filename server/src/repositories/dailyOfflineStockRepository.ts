import { Shift } from "@prisma/client";
import { prisma } from "../lib/prisma";
import { toNum } from "../utils/stockMath";

export interface OfflineStockData {
  productId: number;
  entryDate: Date;
  shift: Shift;
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

/// Section 5.3 - daily_offline_stock: one row per product, per date, per shift.
export const dailyOfflineStockRepository = {
  findByProductAndDate(productId: number, entryDate: Date, shift: Shift) {
    return prisma.dailyOfflineStock.findUnique({ where: { productId_entryDate_shift: { productId, entryDate, shift } } });
  },

  findAllForDate(entryDate: Date, shift: Shift) {
    return prisma.dailyOfflineStock.findMany({ where: { entryDate, shift } });
  },

  /// Section 4.6 - same shift-aware carry-forward principle as the Online
  /// table; see dailyOnlineStockRepository.getOpeningStock for the full
  /// reasoning on why the "immediately preceding shift" is always
  /// deterministic rather than a search across arbitrary shift values.
  async getOpeningStock(productId: number, entryDate: Date, shift: Shift): Promise<number> {
    const prior = await prisma.dailyOfflineStock.findFirst({
      where: {
        productId,
        OR:
          shift === "NIGHT"
            ? [{ entryDate: { lt: entryDate } }, { entryDate, shift: "MORNING" }]
            : [{ entryDate: { lt: entryDate } }],
      },
      orderBy: [{ entryDate: "desc" }, { shift: "desc" }],
      select: { remainingStock: true },
    });
    return toNum(prior?.remainingStock ?? 0);
  },

  /// Batched form of getOpeningStock - see dailyOnlineStockRepository's
  /// getOpeningStocksForProducts for why this matters (N+1 avoidance) and
  /// how the "immediate predecessor, falling back to latest earlier row"
  /// resolution works.
  async getOpeningStocksForProducts(productIds: number[], entryDate: Date, shift: Shift): Promise<Map<number, number>> {
    if (!productIds.length) return new Map();
    const result = new Map<number, number>();

    if (shift === "NIGHT") {
      const sameDayMorning = await prisma.dailyOfflineStock.findMany({
        where: { productId: { in: productIds }, entryDate, shift: "MORNING" },
        select: { productId: true, remainingStock: true },
      });
      for (const row of sameDayMorning) result.set(row.productId, toNum(row.remainingStock));
    }

    const stillMissing = productIds.filter((id) => !result.has(id));
    if (!stillMissing.length) return result;

    const latest = await prisma.dailyOfflineStock.groupBy({
      by: ["productId"],
      where: { productId: { in: stillMissing }, entryDate: { lt: entryDate } },
      _max: { entryDate: true },
    });
    const pairs = latest.filter((l) => l._max.entryDate).map((l) => ({ productId: l.productId, entryDate: l._max.entryDate as Date }));
    if (!pairs.length) return result;

    const rows = await prisma.dailyOfflineStock.findMany({
      where: { OR: pairs.map((p) => ({ productId: p.productId, entryDate: p.entryDate })) },
      select: { productId: true, shift: true, remainingStock: true },
    });
    const rowsByProduct = new Map<number, typeof rows>();
    for (const row of rows) rowsByProduct.set(row.productId, [...(rowsByProduct.get(row.productId) ?? []), row]);
    for (const [productId, candidates] of rowsByProduct) {
      const chosen = candidates.find((r) => r.shift === "NIGHT") ?? candidates[0];
      result.set(productId, toNum(chosen.remainingStock));
    }
    return result;
  },

  upsert(id: number | undefined, data: OfflineStockData) {
    return id
      ? prisma.dailyOfflineStock.update({ where: { id }, data })
      : prisma.dailyOfflineStock.create({ data });
  },
};
