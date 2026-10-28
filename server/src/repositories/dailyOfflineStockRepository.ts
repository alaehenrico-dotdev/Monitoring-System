import { Shift } from "@prisma/client";
import { prisma, type Db } from "../lib/prisma";
import { manualCountRepository } from "./manualCountRepository";
import { resolveOpeningStock } from "../utils/stockMath";

export interface OfflineStockData {
  productId: number;
  entryDate: Date;
  shift: Shift;
  openingStock: number;
  /// True once typed/imported rather than carried - see the schema.
  openingManual?: boolean;
  stockInOlToOff: number;
  stockOutOffToOl: number;
  offlineStock: number;
  productionIn: number;
  deliveryOut: number;
  /// The five delivery slots deliveryOut is the sum of. Optional so callers that
  /// only re-derive stock figures (carry-forward) leave the slots untouched.
  delivery1?: number;
  delivery2?: number;
  delivery3?: number;
  delivery4?: number;
  delivery5?: number;
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

  /// See dailyOnlineStockRepository.findNext.
  findNext(productId: number, entryDate: Date, shift: Shift, db: Db = prisma) {
    return db.dailyOfflineStock.findFirst({
      where: {
        productId,
        OR: shift === "MORNING" ? [{ entryDate: { gt: entryDate } }, { entryDate, shift: "NIGHT" }] : [{ entryDate: { gt: entryDate } }],
      },
      orderBy: [{ entryDate: "asc" }, { shift: "asc" }],
    });
  },

  /// Section 4.6 - same shift-aware carry-forward principle as the Online
  /// table; see dailyOnlineStockRepository.getOpeningStock for the full
  /// reasoning on why the "immediately preceding shift" is always
  /// deterministic rather than a search across arbitrary shift values.
  ///
  /// Section 4.4 - an Offline manual count that a supervisor PUBLISHED WITH "use
  /// as next day's opening" (manualCount.appliedToOpening) is a fresh starting
  /// record: it supersedes the system-computed Remaining Stock as the opening
  /// balance, because a count exists specifically to correct the system figure
  /// (shrinkage, miscounts, etc.) - the corrected number, not the
  /// pre-correction one, is what the next period starts from. The latest such
  /// count competes with the latest saved row and the later wins; from then on
  /// each day carries on from its OWN remaining stock until the next applied
  /// count. Unpublished or audit-only counts never open anything. A
  /// TOTAL-location count is never consulted: it can't be unambiguously split
  /// back into an Online/Offline balance, so it stays purely informational
  /// (Variance Report / Total Stocks).
  ///
  /// Counts open the next DATE, whichever shift they were taken on (KNOWN GAP
  /// for MORNING counts - see dailyOnlineStockRepository.getOpeningStock and the
  /// it.fails cases in openingStock.test.ts before changing this).
  ///
  /// `rowCreatedAt` is only for the ordinary carry-forward walks (an entry save
  /// must not move a chain it did not touch): a period first saved BEFORE a
  /// count was published ignores that count. Publishing a count (a re-audit)
  /// passes none - propagateOpeningStock's `reachSaved` - so the new count DOES
  /// reach days already saved. Full policy: propagateOpeningStock in
  /// manualCounts.service.ts.
  async getOpeningStock(productId: number, entryDate: Date, shift: Shift, db: Db = prisma, rowCreatedAt?: Date): Promise<number> {
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
    // Opening is this carried-forward figure (or an import's), except when an
    // APPLIED count is newer than the latest row (>= on the date: a count wins a
    // tie). `rowCreatedAt`, when given, hides counts published after that row
    // was first saved - see the doc comment above for who passes it and why.
    const count = await manualCountRepository.findLatestBefore(productId, entryDate, "OFFLINE", db, rowCreatedAt);
    if (count && (!prior || count.entryDate.getTime() >= prior.entryDate.getTime())) {
      return resolveOpeningStock(count.manualCount, 0);
    }
    if (!prior) return 0;
    return resolveOpeningStock(undefined, prior.remainingStock);
  },

  /// Batched form of getOpeningStock - see dailyOnlineStockRepository's
  /// getOpeningStocksForProducts for why this matters (N+1 avoidance) and
  /// how the "immediate predecessor, falling back to latest earlier row"
  /// resolution works, and getOpeningStock above for the manual-count
  /// override itself. Each product resolves to exactly one candidate period
  /// (either path below, never both), so the one follow-up manual-count
  /// query - covering every resolved period at once - is enough regardless
  /// of how many products are missing.
  async getOpeningStocksForProducts(productIds: number[], entryDate: Date, shift: Shift, createdAtByProduct?: Map<number, Date>): Promise<Map<number, number>> {
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

    // Same rule as getOpeningStock: only an applied count beats the carry.
    const counts = await manualCountRepository.findLatestBeforeForProducts(productIds, entryDate, "OFFLINE", createdAtByProduct);
    const countByProduct = new Map(counts.map((m) => [m.productId, m]));

    for (const productId of productIds) {
      const c = candidates.get(productId);
      const count = countByProduct.get(productId);
      if (count && (!c || count.entryDate.getTime() >= c.entryDate.getTime())) {
        result.set(productId, resolveOpeningStock(count.manualCount, 0));
      } else if (c) {
        result.set(productId, resolveOpeningStock(undefined, c.remainingStock));
      }
    }
    return result;
  },

  upsert(id: number | undefined, data: OfflineStockData, db: Db = prisma) {
    return id
      ? db.dailyOfflineStock.update({ where: { id }, data })
      : db.dailyOfflineStock.create({ data });
  },
};
