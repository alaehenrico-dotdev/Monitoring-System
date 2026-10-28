import { Shift } from "@prisma/client";
import { prisma, type Db } from "../lib/prisma";
import { manualCountRepository } from "./manualCountRepository";
import { resolveOpeningStock } from "../utils/stockMath";

export interface OnlineStockData {
  productId: number;
  entryDate: Date;
  shift: Shift;
  openingStock: number;
  /// True once typed/imported rather than carried - see the schema.
  openingManual?: boolean;
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

  /// The earliest saved row strictly after the given period (Morning < Night
  /// within a date) - used to push a newly saved manual count forward into
  /// the row that carried the old figure as its opening stock.
  findNext(productId: number, entryDate: Date, shift: Shift, db: Db = prisma) {
    return db.dailyOnlineStock.findFirst({
      where: {
        productId,
        OR: shift === "MORNING" ? [{ entryDate: { gt: entryDate } }, { entryDate, shift: "NIGHT" }] : [{ entryDate: { gt: entryDate } }],
      },
      orderBy: [{ entryDate: "asc" }, { shift: "asc" }],
    });
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
  /// Section 4.4 - an Online manual count that a supervisor PUBLISHED WITH "use
  /// as next day's opening" (manualCount.appliedToOpening) is a fresh starting
  /// record: it supersedes the system-computed Remaining Stock as the opening
  /// balance, because it exists to correct that figure (shrinkage, miscounts).
  /// The latest such count competes with the latest saved row and the later
  /// wins; from then on each day carries on from its OWN remaining stock until
  /// the next applied count. Counts that are unpublished, or published as an
  /// audit only, never open anything. A TOTAL-location count is never
  /// consulted: it can't be split back into an Online/Offline balance.
  ///
  /// Counts open the next DATE (count date < this date), whichever shift they
  /// were taken on. KNOWN GAP: a MORNING count therefore neither opens its own
  /// day's Night sheet nor lets that Night's movements reach the next day.
  /// Audits are expected on the Night sheet (or in whole-day mode); see the
  /// it.fails cases in openingStock.test.ts before changing this.
  ///
  /// `rowCreatedAt` is only for the ordinary carry-forward walks (an entry
  /// save must not move a chain it did not touch): a period first saved BEFORE
  /// a count was published ignores that count. Publishing a count (a re-audit)
  /// deliberately passes none - propagateOpeningStock's `reachSaved` - so the
  /// new count DOES reach days already saved. Full policy: propagateOpeningStock
  /// in manualCounts.service.ts. Offline mirrors this function exactly.
  async getOpeningStock(productId: number, entryDate: Date, shift: Shift, db: Db = prisma, rowCreatedAt?: Date): Promise<number> {
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
    // Opening is this carried-forward figure (or an import's), except when an
    // APPLIED count is newer than the latest row (>= on the date: a count wins a
    // tie). `rowCreatedAt`, when given, hides counts published after that row
    // was first saved - see the doc comment above for who passes it and why.
    const count = await manualCountRepository.findLatestBefore(productId, entryDate, "ONLINE", db, rowCreatedAt);
    if (count && (!prior || count.entryDate.getTime() >= prior.entryDate.getTime())) {
      return resolveOpeningStock(count.manualCount, 0);
    }
    if (!prior) return 0;
    return resolveOpeningStock(undefined, prior.remainingStock);
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
  async getOpeningStocksForProducts(productIds: number[], entryDate: Date, shift: Shift, createdAtByProduct?: Map<number, Date>): Promise<Map<number, number>> {
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

    // Same rule as getOpeningStock: only an applied count beats the carry.
    const counts = await manualCountRepository.findLatestBeforeForProducts(productIds, entryDate, "ONLINE", createdAtByProduct);
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

  upsert(id: number | undefined, data: OnlineStockData, db: Db = prisma) {
    return id
      ? db.dailyOnlineStock.update({ where: { id }, data })
      : db.dailyOnlineStock.create({ data });
  },
};
