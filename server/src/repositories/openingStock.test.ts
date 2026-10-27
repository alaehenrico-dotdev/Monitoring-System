import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * How a period's opening stock is resolved once an audit has been published as
 * the next day's opening. Runs the real Online/Offline repositories and the real
 * manual-count lookups against a small in-memory database, so the rules are
 * tested as one: an applied count is a fresh starting record, every later day
 * carries on from its own remaining stock, and a day saved before the publish
 * keeps the chain it was saved in.
 */

type Shift = "MORNING" | "NIGHT";
interface Row {
  productId: number;
  entryDate: Date;
  shift: Shift;
  remainingStock: number;
}
interface Count {
  productId: number;
  location: "ONLINE" | "OFFLINE";
  entryDate: Date;
  shift: Shift;
  manualCount: number;
  publishedAt: Date | null;
  appliedToOpening: boolean;
}

const db = vi.hoisted(() => ({ online: [] as Row[], offline: [] as Row[], counts: [] as Count[] }));

const day = (d: string) => new Date(`${d}T00:00:00.000Z`);
const rank = (r: { entryDate: Date; shift: Shift }) => r.entryDate.getTime() * 2 + (r.shift === "NIGHT" ? 1 : 0);

function rowTable(rows: () => Row[]) {
  return {
    findFirst: vi.fn(async ({ where }: { where: { productId: number; OR: Array<{ entryDate: { lt: Date } | Date; shift?: Shift }> } }) => {
      const matches = rows().filter((r) => r.productId === where.productId).filter((r) =>
        where.OR.some((c) => {
          if (c.entryDate instanceof Date) return r.entryDate.getTime() === c.entryDate.getTime() && r.shift === c.shift;
          return r.entryDate.getTime() < c.entryDate.lt.getTime();
        }),
      );
      return matches.sort((a, b) => rank(b) - rank(a))[0] ?? null;
    }),
    findMany: vi.fn(async ({ where }: { where: { productId: { in: number[] }; entryDate: Date | { lt: Date }; shift?: Shift; OR?: Array<{ productId: number; entryDate: Date }> } }) => {
      return rows().filter((r) => {
        if (where.OR) return where.OR.some((c) => c.productId === r.productId && c.entryDate.getTime() === r.entryDate.getTime());
        if (!where.productId.in.includes(r.productId)) return false;
        if (where.entryDate instanceof Date) return r.entryDate.getTime() === where.entryDate.getTime() && r.shift === where.shift;
        return true;
      });
    }),
    groupBy: vi.fn(async ({ where }: { where: { productId: { in: number[] }; entryDate: { lt: Date } } }) => {
      const out = new Map<number, Date>();
      for (const r of rows()) {
        if (!where.productId.in.includes(r.productId) || r.entryDate.getTime() >= where.entryDate.lt.getTime()) continue;
        if (!out.has(r.productId) || r.entryDate.getTime() > out.get(r.productId)!.getTime()) out.set(r.productId, r.entryDate);
      }
      return [...out].map(([productId, d]) => ({ productId, _max: { entryDate: d } }));
    }),
  };
}

function matchingCounts(where: { productId?: number | { in: number[] }; location: string; entryDate: { lt: Date }; publishedAt: { not: null; lte?: Date } }) {
  return db.counts
    .filter((c) => c.location === where.location && c.appliedToOpening && c.publishedAt !== null)
    .filter((c) => (typeof where.productId === "number" ? c.productId === where.productId : where.productId?.in.includes(c.productId)))
    .filter((c) => c.entryDate.getTime() < where.entryDate.lt.getTime())
    .filter((c) => !where.publishedAt.lte || c.publishedAt!.getTime() <= where.publishedAt.lte.getTime())
    .sort((a, b) => rank(b) - rank(a));
}

const prismaMock = vi.hoisted(() => ({}) as Record<string, unknown>);
vi.mock("../lib/prisma", () => ({ prisma: prismaMock }));

import { dailyOnlineStockRepository } from "./dailyOnlineStockRepository";
import { dailyOfflineStockRepository } from "./dailyOfflineStockRepository";

beforeEach(() => {
  db.online = [];
  db.offline = [];
  db.counts = [];
  Object.assign(prismaMock, {
    dailyOnlineStock: rowTable(() => db.online),
    dailyOfflineStock: rowTable(() => db.offline),
    manualCount: {
      findFirst: vi.fn(async ({ where }: { where: Parameters<typeof matchingCounts>[0] }) => matchingCounts(where)[0] ?? null),
      findMany: vi.fn(async ({ where, distinct }: { where: Parameters<typeof matchingCounts>[0]; distinct?: string[] }) => {
        const all = matchingCounts(where);
        if (!distinct) return all;
        const seen = new Set<number>();
        return all.filter((c) => !seen.has(c.productId) && seen.add(c.productId));
      }),
    },
  });
});

const applied = (productId: number, date: string, manualCount: number, publishedAt = `${date}T20:00:00.000Z`): Count => ({
  productId,
  location: "ONLINE",
  entryDate: day(date),
  shift: "NIGHT",
  manualCount,
  publishedAt: new Date(publishedAt),
  appliedToOpening: true,
});

describe("an audit published as the next day's opening", () => {
  it("opens the next day at the counted figure, not the system's remaining stock", async () => {
    db.online = [{ productId: 1, entryDate: day("2026-06-10"), shift: "NIGHT", remainingStock: 20 }];
    db.counts = [applied(1, "2026-06-10", 16)];

    expect(await dailyOnlineStockRepository.getOpeningStock(1, day("2026-06-11"), "MORNING")).toBe(16);
  });

  it("then carries on day by day: 16 counted, 1 in on the next day, 17 opens the day after", async () => {
    db.online = [
      { productId: 1, entryDate: day("2026-06-10"), shift: "NIGHT", remainingStock: 20 },
      { productId: 1, entryDate: day("2026-06-11"), shift: "MORNING", remainingStock: 17 },
    ];
    db.counts = [applied(1, "2026-06-10", 16)];

    expect(await dailyOnlineStockRepository.getOpeningStock(1, day("2026-06-12"), "MORNING")).toBe(17);
  });

  it("keeps following the chain for days that were never saved in between", async () => {
    db.online = [{ productId: 1, entryDate: day("2026-06-10"), shift: "NIGHT", remainingStock: 20 }];
    db.counts = [applied(1, "2026-06-10", 16)];

    // 11th, 12th and 13th were not entered: the 14th still opens at the count.
    expect(await dailyOnlineStockRepository.getOpeningStock(1, day("2026-06-14"), "MORNING")).toBe(16);
  });

  it("a newer applied audit starts a new record: the old one no longer matters", async () => {
    db.online = [
      { productId: 1, entryDate: day("2026-06-10"), shift: "NIGHT", remainingStock: 20 },
      { productId: 1, entryDate: day("2026-06-11"), shift: "MORNING", remainingStock: 17 },
      { productId: 1, entryDate: day("2026-06-12"), shift: "MORNING", remainingStock: 15 },
    ];
    db.counts = [applied(1, "2026-06-10", 16), applied(1, "2026-06-12", 30)];

    expect(await dailyOnlineStockRepository.getOpeningStock(1, day("2026-06-13"), "MORNING")).toBe(30);
    // ...and the day it was counted on still opened from the first record's chain.
    expect(await dailyOnlineStockRepository.getOpeningStock(1, day("2026-06-12"), "MORNING")).toBe(17);
  });

  it("does not depend on the days before it: those rows can change without moving the new record", async () => {
    db.online = [
      { productId: 1, entryDate: day("2026-06-09"), shift: "NIGHT", remainingStock: 999 },
      { productId: 1, entryDate: day("2026-06-10"), shift: "NIGHT", remainingStock: 5 },
    ];
    db.counts = [applied(1, "2026-06-10", 16)];

    expect(await dailyOnlineStockRepository.getOpeningStock(1, day("2026-06-11"), "MORNING")).toBe(16);
  });

  it("reaches a Night shift too, when the day's Morning was never saved", async () => {
    db.online = [{ productId: 1, entryDate: day("2026-06-10"), shift: "NIGHT", remainingStock: 20 }];
    db.counts = [applied(1, "2026-06-10", 16)];

    expect(await dailyOnlineStockRepository.getOpeningStock(1, day("2026-06-11"), "NIGHT")).toBe(16);
  });

  it("but a Night shift opens from its own day's Morning when that was saved", async () => {
    db.online = [
      { productId: 1, entryDate: day("2026-06-10"), shift: "NIGHT", remainingStock: 20 },
      { productId: 1, entryDate: day("2026-06-11"), shift: "MORNING", remainingStock: 17 },
    ];
    db.counts = [applied(1, "2026-06-10", 16)];

    expect(await dailyOnlineStockRepository.getOpeningStock(1, day("2026-06-11"), "NIGHT")).toBe(17);
  });

  describe("a MORNING audit, with that day's Night sheet saved too (KNOWN GAP)", () => {
    // Counted at the end of the Morning: 16 against a system figure of 20. The Night
    // sheet then moves 4 out (Night opens at the count: 16 -> 12), so 12 is what the
    // next day must open at - not the count again, which would forget the Night's 4.
    //
    // KNOWN GAP, not the intended behaviour: an applied count opens the next DATE, so a
    // Morning count neither opens its own Night sheet nor lets the Night's movements
    // reach the next day. Audits taken at the end of the day (the Night sheet, and
    // whole-day mode) are unaffected. `it.fails` keeps this on record: when the lookup
    // becomes shift-aware these start passing and vitest flags them to be switched to `it`.
    const morning = (): Count => ({ ...applied(1, "2026-06-10", 16), shift: "MORNING" });
    const rows = (): Row[] => [
      { productId: 1, entryDate: day("2026-06-10"), shift: "MORNING", remainingStock: 20 },
      { productId: 1, entryDate: day("2026-06-10"), shift: "NIGHT", remainingStock: 12 },
    ];

    it.fails("opens that same day's Night at the count", async () => {
      db.online = rows();
      db.counts = [morning()];

      expect(await dailyOnlineStockRepository.getOpeningStock(1, day("2026-06-10"), "NIGHT")).toBe(16);
    });

    it.fails("opens the next day from the Night's remaining, not from the count again", async () => {
      db.online = rows();
      db.counts = [morning()];

      expect(await dailyOnlineStockRepository.getOpeningStock(1, day("2026-06-11"), "MORNING")).toBe(12);
    });
  });

  it("an unpublished or audit-only count never opens anything", async () => {
    db.online = [{ productId: 1, entryDate: day("2026-06-10"), shift: "NIGHT", remainingStock: 20 }];
    db.counts = [{ ...applied(1, "2026-06-10", 16), appliedToOpening: false }, { ...applied(1, "2026-06-09", 3), publishedAt: null }];

    expect(await dailyOnlineStockRepository.getOpeningStock(1, day("2026-06-11"), "MORNING")).toBe(20);
  });

  it("works the same for the Offline side", async () => {
    db.offline = [{ productId: 1, entryDate: day("2026-06-10"), shift: "NIGHT", remainingStock: 20 }];
    db.counts = [{ ...applied(1, "2026-06-10", 16), location: "OFFLINE" }];

    expect(await dailyOfflineStockRepository.getOpeningStock(1, day("2026-06-11"), "MORNING")).toBe(16);
  });
});

describe("a day saved before the audit was published keeps its figures", () => {
  const savedBefore = new Date("2026-06-10T10:00:00.000Z"); // first saved before the 20:00 publish

  it("ignores the audit: it keeps carrying the chain it was saved in", async () => {
    db.online = [{ productId: 1, entryDate: day("2026-06-10"), shift: "NIGHT", remainingStock: 20 }];
    db.counts = [applied(1, "2026-06-10", 16)];

    expect(await dailyOnlineStockRepository.getOpeningStock(1, day("2026-06-11"), "MORNING", undefined, savedBefore)).toBe(20);
  });

  it("takes the audit when it was first saved after the publish", async () => {
    db.online = [{ productId: 1, entryDate: day("2026-06-10"), shift: "NIGHT", remainingStock: 20 }];
    db.counts = [applied(1, "2026-06-10", 16)];

    expect(await dailyOnlineStockRepository.getOpeningStock(1, day("2026-06-11"), "MORNING", undefined, new Date("2026-06-11T08:00:00.000Z"))).toBe(16);
  });

  it("an older audit that did come first still applies to a row saved after it", async () => {
    db.online = [{ productId: 1, entryDate: day("2026-06-12"), shift: "NIGHT", remainingStock: 8 }];
    db.counts = [applied(1, "2026-06-05", 40), applied(1, "2026-06-12", 8, "2026-06-12T20:00:00.000Z")];
    const savedBetween = new Date("2026-06-08T09:00:00.000Z");

    // The 06-12 count was published after this row was saved; the 06-05 one was before.
    expect(await dailyOnlineStockRepository.getOpeningStock(1, day("2026-06-09"), "MORNING", undefined, savedBetween)).toBe(40);
  });

  it("the batched lookup applies the same gate per product", async () => {
    db.online = [
      { productId: 1, entryDate: day("2026-06-10"), shift: "NIGHT", remainingStock: 20 },
      { productId: 2, entryDate: day("2026-06-10"), shift: "NIGHT", remainingStock: 20 },
    ];
    db.counts = [applied(1, "2026-06-10", 16), applied(2, "2026-06-10", 16)];

    const out = await dailyOnlineStockRepository.getOpeningStocksForProducts([1, 2], day("2026-06-11"), "MORNING", new Map([[1, savedBefore]]));

    expect(out.get(1)).toBe(20); // product 1's day was saved before the publish
    expect(out.get(2)).toBe(16); // product 2 has no saved day, so it opens at the count
  });

  it("the batched lookup also reaches a Night shift", async () => {
    db.online = [{ productId: 1, entryDate: day("2026-06-10"), shift: "NIGHT", remainingStock: 20 }];
    db.counts = [applied(1, "2026-06-10", 16)];

    const out = await dailyOnlineStockRepository.getOpeningStocksForProducts([1], day("2026-06-11"), "NIGHT");

    expect(out.get(1)).toBe(16);
  });
});
