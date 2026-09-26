import { Shift } from "@prisma/client";
import { prisma, type Db } from "../lib/prisma";
import { manualCountRepository } from "./manualCountRepository";
import { resolveOpeningStock } from "../utils/stockMath";

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
  upsellOut: number;
  remainingStock: number;
  encodedById?: number;
}

/// Section 5.3 - daily_offline_stock: one row per product, per date, per shift.
export const dailyOfflineStockRepository = {
  findByProductAndDate(productId: number, entryDate: Date, shift: Shift, db: Db = prisma) {
    return db.dailyOfflineStock.findUnique({ where: { productId_entryDate_shift: { productId, entryDate, shift } } });
  },

  findAllForDate(entryDate: Date, shift: Shift) {
    return prisma.dailyOfflineStock.findMany({ where: { entryDate, shift } });
  },

  /// Section 4.6 - same shift-aware carry-forward principle as the Online
  /// table; see dailyOnlineStockRepository.getOpeningStock for the full
  /// reasoning on why the "immediately preceding shift" is always
  /// deterministic rather than a search across arbitrary shift values.
  ///
  /// Section 4.4 - if that immediately preceding period also has a saved
  /// Offline manual count, the physical count supersedes its own
  /// system-computed Remaining Stock as the opening balance here: a manual
  /// count exists specifically to correct the system figure (shrinkage,
  /// miscounts, etc.), so the corrected number - not the pre-correction one -
  /// is what the next period should actually start from. This only ever
  /// looks at the ONE period being carried forward from, never re-derives
  /// anything earlier, so it can't retroactively change an opening stock
  /// some later, already-saved period already carried forward (matching
  /// this table's existing "captured once, at save time" contract - see
  /// carryForward.test.ts). A TOTAL-location count is deliberately not
  /// consulted here - it can't be unambiguously split back into an
  /// Online/Offline balance, so it stays purely informational (Variance
  /// Report / Total Stocks) rather than ever overriding this table.
  async getOpeningStock(productId: number, entryDate: Date, shift: Shift, db: Db = prisma): Promise<number> {
    const prior = await db.dailyOfflineStock.findFirst({
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
    const manualCount = await manualCountRepository.findOne(productId, prior.entryDate, prior.shift, "OFFLINE", db);
    return resolveOpeningStock(manualCount?.manualCount, prior.remainingStock);
  },

  /// Batched form of getOpeningStock - see dailyOnlineStockRepository's
  /// getOpeningStocksForProducts for why this matters (N+1 avoidance) and
  /// how the "immediate predecessor, falling back to latest earlier row"
  /// resolution works, and getOpeningStock above for the manual-count
  /// override itself. Each product resolves to exactly one candidate period
  /// (either path below, never both), so the one follow-up manual-count
  /// query - covering every resolved period at once - is enough regardless
  /// of how many products are missing.
  async getOpeningStocksForProducts(productIds: number[], entryDate: Date, shift: Shift): Promise<Map<number, number>> {
    if (!productIds.length) return new Map();
    const result = new Map<number, number>();
    const candidates = new Map<number, { entryDate: Date; shift: Shift; remainingStock: unknown }>();

    if (shift === "NIGHT") {
      const sameDayMorning = await prisma.dailyOfflineStock.findMany({
        where: { productId: { in: productIds }, entryDate, shift: "MORNING" },
        select: { productId: true, remainingStock: true },
      });
      for (const row of sameDayMorning) candidates.set(row.productId, { entryDate, shift: "MORNING", remainingStock: row.remainingStock });
    }

    const stillMissing = productIds.filter((id) => !candidates.has(id));
    if (stillMissing.length) {
      const latest = await prisma.dailyOfflineStock.groupBy({
        by: ["productId"],
        where: { productId: { in: stillMissing }, entryDate: { lt: entryDate } },
        _max: { entryDate: true },
      });
      const pairs = latest.filter((l) => l._max.entryDate).map((l) => ({ productId: l.productId, entryDate: l._max.entryDate as Date }));
      if (pairs.length) {
        const rows = await prisma.dailyOfflineStock.findMany({
          where: { OR: pairs.map((p) => ({ productId: p.productId, entryDate: p.entryDate })) },
          select: { productId: true, entryDate: true, shift: true, remainingStock: true },
        });
        const rowsByProduct = new Map<number, typeof rows>();
        for (const row of rows) rowsByProduct.set(row.productId, [...(rowsByProduct.get(row.productId) ?? []), row]);
        for (const [productId, rowsForProduct] of rowsByProduct) {
          const chosen = rowsForProduct.find((r) => r.shift === "NIGHT") ?? rowsForProduct[0];
          candidates.set(productId, { entryDate: chosen.entryDate, shift: chosen.shift, remainingStock: chosen.remainingStock });
        }
      }
    }

    if (candidates.size === 0) return result;

    const manualCounts = await manualCountRepository.findManyForKeys(
      [...candidates.entries()].map(([productId, c]) => ({ productId, entryDate: c.entryDate, shift: c.shift })),
      "OFFLINE",
    );
    const manualCountByProduct = new Map(manualCounts.map((m) => [m.productId, m.manualCount]));

    for (const [productId, c] of candidates) {
      result.set(productId, resolveOpeningStock(manualCountByProduct.get(productId), c.remainingStock));
    }
    return result;
  },

  upsert(id: number | undefined, data: OfflineStockData, db: Db = prisma) {
    return id
      ? db.dailyOfflineStock.update({ where: { id }, data })
      : db.dailyOfflineStock.create({ data });
  },
};
