import { Shift } from "@prisma/client";
import { prisma, type Db } from "../lib/prisma";
import { manualCountRepository } from "./manualCountRepository";
import { resolveOpeningStock } from "../utils/stockMath";

export interface OnlineStockData {
  productId: number;
  entryDate: Date;
  shift: Shift;
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

/// Section 5.2 - daily_online_stock: one row per product, per date, per shift.
export const dailyOnlineStockRepository = {
  findByProductAndDate(productId: number, entryDate: Date, shift: Shift, db: Db = prisma) {
    return db.dailyOnlineStock.findUnique({ where: { productId_entryDate_shift: { productId, entryDate, shift } } });
  },

  findAllForDate(entryDate: Date, shift: Shift) {
    return prisma.dailyOnlineStock.findMany({ where: { entryDate, shift } });
  },

  /// Section 4.6 - auto carry-forward: the immediately preceding shift's
  /// Remaining Stock becomes this shift's opening Stock. Shifts run in a
  /// strict, fixed order (Morning, then Night, then next date's Morning...),
  /// so the shift immediately before Night is always this same date's
  /// Morning, and the shift immediately before Morning is always the
  /// previous date's Night - never a search across arbitrary shift values.
  /// If that immediate predecessor was never actually saved (e.g. an
  /// encoder skipped a shift), this falls back to the most recent
  /// still-earlier row instead of resetting to a misleading 0.
  ///
  /// Section 4.4 - if that immediately preceding period also has a saved
  /// Online manual count, the physical count supersedes its own
  /// system-computed Remaining Stock as the opening balance here - see
  /// dailyOfflineStockRepository.getOpeningStock's identical comment for
  /// the full reasoning (why it's only the one period being carried forward
  /// from, why it never ripples into a later already-saved period, and why
  /// a TOTAL-location count is never consulted here).
  async getOpeningStock(productId: number, entryDate: Date, shift: Shift, db: Db = prisma): Promise<number> {
    const prior = await db.dailyOnlineStock.findFirst({
      where: {
        productId,
        OR:
          shift === "NIGHT"
            ? [{ entryDate: { lt: entryDate } }, { entryDate, shift: "MORNING" }]
            : [{ entryDate: { lt: entryDate } }],
      },
      orderBy: [{ entryDate: "desc" }, { shift: "desc" }],
      select: { entryDate: true, shift: true, remainingStock: true },
    });
    if (!prior) return 0;
    const manualCount = await manualCountRepository.findOne(productId, prior.entryDate, prior.shift, "ONLINE", db);
    return resolveOpeningStock(manualCount?.manualCount, prior.remainingStock);
  },

  /// Batched form of getOpeningStock for an entire grid load. Naively calling
  /// getOpeningStock once per product turns a single grid fetch into up to
  /// ~60 sequential queries (an N+1 pattern) whenever most of that shift's
  /// rows haven't been saved yet. This does it in at most four queries
  /// regardless of how many products are missing, following the same
  /// "immediate predecessor, falling back to the latest earlier row"
  /// resolution as getOpeningStock above - including its manual-count
  /// override, applied here as one extra batched query (covering every
  /// resolved period at once) rather than one per product.
  async getOpeningStocksForProducts(productIds: number[], entryDate: Date, shift: Shift): Promise<Map<number, number>> {
    if (!productIds.length) return new Map();
    const result = new Map<number, number>();
    const candidates = new Map<number, { entryDate: Date; shift: Shift; remainingStock: unknown }>();

    if (shift === "NIGHT") {
      const sameDayMorning = await prisma.dailyOnlineStock.findMany({
        where: { productId: { in: productIds }, entryDate, shift: "MORNING" },
        select: { productId: true, remainingStock: true },
      });
      for (const row of sameDayMorning) candidates.set(row.productId, { entryDate, shift: "MORNING", remainingStock: row.remainingStock });
    }

    const stillMissing = productIds.filter((id) => !candidates.has(id));
    if (stillMissing.length) {
      const latest = await prisma.dailyOnlineStock.groupBy({
        by: ["productId"],
        where: { productId: { in: stillMissing }, entryDate: { lt: entryDate } },
        _max: { entryDate: true },
      });
      const pairs = latest.filter((l) => l._max.entryDate).map((l) => ({ productId: l.productId, entryDate: l._max.entryDate as Date }));
      if (pairs.length) {
        const rows = await prisma.dailyOnlineStock.findMany({
          where: { OR: pairs.map((p) => ({ productId: p.productId, entryDate: p.entryDate })) },
          select: { productId: true, entryDate: true, shift: true, remainingStock: true },
        });
        const rowsByProduct = new Map<number, typeof rows>();
        for (const row of rows) rowsByProduct.set(row.productId, [...(rowsByProduct.get(row.productId) ?? []), row]);
        // A given earlier date can have both shifts saved - Night is the
        // later, more-recent one whenever both exist.
        for (const [productId, rowsForProduct] of rowsByProduct) {
          const chosen = rowsForProduct.find((r) => r.shift === "NIGHT") ?? rowsForProduct[0];
          candidates.set(productId, { entryDate: chosen.entryDate, shift: chosen.shift, remainingStock: chosen.remainingStock });
        }
      }
    }

    if (candidates.size === 0) return result;

    const manualCounts = await manualCountRepository.findManyForKeys(
      [...candidates.entries()].map(([productId, c]) => ({ productId, entryDate: c.entryDate, shift: c.shift })),
      "ONLINE",
    );
    const manualCountByProduct = new Map(manualCounts.map((m) => [m.productId, m.manualCount]));

    for (const [productId, c] of candidates) {
      result.set(productId, resolveOpeningStock(manualCountByProduct.get(productId), c.remainingStock));
    }
    return result;
  },

  upsert(id: number | undefined, data: OnlineStockData, db: Db = prisma) {
    return id
      ? db.dailyOnlineStock.update({ where: { id }, data })
      : db.dailyOnlineStock.create({ data });
  },
};
