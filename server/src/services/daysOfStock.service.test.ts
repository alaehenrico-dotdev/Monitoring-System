import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../lib/prisma", () => ({
  prisma: {
    dailyOnlineStock: { groupBy: vi.fn() },
    dailyOfflineStock: { groupBy: vi.fn() },
  },
}));
vi.mock("./totalStocks.service", () => ({ getTotalStocksGrid: vi.fn() }));

import { prisma } from "../lib/prisma";
import { getTotalStocksGrid } from "./totalStocks.service";
import { getDaysOfStock } from "./daysOfStock.service";

const AS_OF = new Date("2026-10-09T00:00:00Z");

function product(
  id: number,
  name: string,
  totalRemainingStock: number,
  lowStockThreshold: number | null = null,
) {
  return {
    product: {
      id,
      name,
      sku: `AFP00${id}`,
      unit: "Liter",
      category: "Class A",
      lowStockThreshold,
    },
    totalRemainingStock,
  };
}

/// n consecutive dates ending the day before AS_OF, so they all sit inside
/// the 14-day window.
function days(n: number): Date[] {
  return Array.from({ length: n }, (_, i) => {
    const d = new Date(AS_OF);
    d.setUTCDate(d.getUTCDate() - i);
    return d;
  });
}

function onlineRows(productId: number, perDay: number, dayCount: number) {
  return days(dayCount).map((entryDate) => ({
    productId,
    entryDate,
    _sum: { fulfillmentOut: perDay },
  }));
}

function offlineRows(
  productId: number,
  sums: { deliveryOut?: number; upsellOut?: number; backloads?: number },
  dayCount: number,
) {
  return days(dayCount).map((entryDate) => ({
    productId,
    entryDate,
    _sum: { deliveryOut: 0, upsellOut: 0, backloads: 0, ...sums },
  }));
}

function setup(grid: unknown[], online: unknown[] = [], offline: unknown[] = []) {
  vi.mocked(getTotalStocksGrid).mockResolvedValue(grid as never);
  vi.mocked(prisma.dailyOnlineStock.groupBy).mockResolvedValue(online as never);
  vi.mocked(prisma.dailyOfflineStock.groupBy).mockResolvedValue(offline as never);
}

beforeEach(() => vi.clearAllMocks());

describe("getDaysOfStock - the rate", () => {
  it("divides current stock by the mean daily outflow", async () => {
    setup([product(1, "Sweet A", 100)], onlineRows(1, 10, 14));

    const [row] = await getDaysOfStock(AS_OF);

    expect(row.averageDailyOutflow).toBe(10);
    expect(row.daysLeft).toBe(10);
    expect(row.daysWithData).toBe(14);
  });

  it("averages over days WITH data, not the whole window", async () => {
    // 5 days of data totalling 50 is a rate of 10/day, not 50/14.
    setup([product(1, "Sweet A", 100)], onlineRows(1, 10, 5));

    const [row] = await getDaysOfStock(AS_OF);

    expect(row.averageDailyOutflow).toBe(10);
    expect(row.daysWithData).toBe(5);
  });

  it("counts both shifts of a date as one day of data", async () => {
    // groupBy collapses shifts, but two rows for the same date must not
    // double the divisor even if they arrive separately.
    const sameDay = days(3);
    const rows = [...sameDay, ...sameDay].map((entryDate) => ({
      productId: 1,
      entryDate,
      _sum: { fulfillmentOut: 5 },
    }));
    setup([product(1, "Sweet A", 60)], rows);

    const [row] = await getDaysOfStock(AS_OF);

    expect(row.daysWithData).toBe(3);
    expect(row.averageDailyOutflow).toBe(10); // 30 total / 3 days
  });

  it("adds online fulfilment and offline delivery together", async () => {
    setup(
      [product(1, "Sweet A", 100)],
      onlineRows(1, 4, 5),
      offlineRows(1, { deliveryOut: 6 }, 5),
    );

    const [row] = await getDaysOfStock(AS_OF);
    expect(row.averageDailyOutflow).toBe(10);
  });

  it("counts upsell out as outflow", async () => {
    setup([product(1, "Sweet A", 100)], [], offlineRows(1, { upsellOut: 3 }, 5));
    expect((await getDaysOfStock(AS_OF))[0].averageDailyOutflow).toBe(3);
  });

  it("offsets backloads, which come back into stock", async () => {
    setup(
      [product(1, "Sweet A", 100)],
      [],
      offlineRows(1, { deliveryOut: 10, backloads: 3 }, 5),
    );
    expect((await getDaysOfStock(AS_OF))[0].averageDailyOutflow).toBe(7);
  });

  it("ignores Online<->Offline transfers, which net to zero company-wide", async () => {
    // The groupBy selections below are the whole definition of outflow - a
    // transfer column appearing here would be a regression.
    setup([product(1, "Sweet A", 100)], onlineRows(1, 10, 5));
    await getDaysOfStock(AS_OF);

    const onlineCall = vi.mocked(prisma.dailyOnlineStock.groupBy).mock.calls[0][0];
    const offlineCall = vi.mocked(prisma.dailyOfflineStock.groupBy).mock.calls[0][0];

    expect(onlineCall._sum).toEqual({ fulfillmentOut: true });
    expect(offlineCall._sum).toEqual({ deliveryOut: true, upsellOut: true, backloads: true });
  });
});

describe("getDaysOfStock - when it refuses to answer", () => {
  it("is n/a with fewer than three days of data", async () => {
    setup([product(1, "Sweet A", 100)], onlineRows(1, 10, 2));

    const [row] = await getDaysOfStock(AS_OF);

    expect(row.daysWithData).toBe(2);
    expect(row.averageDailyOutflow).toBeNull();
    expect(row.daysLeft).toBeNull();
  });

  it("is n/a with exactly zero outflow over a long history", async () => {
    setup([product(1, "Sweet A", 100)], onlineRows(1, 0, 14));

    const [row] = await getDaysOfStock(AS_OF);

    expect(row.averageDailyOutflow).toBe(0);
    expect(row.daysLeft).toBeNull();
  });

  it("is n/a for a product with no entries at all in the window", async () => {
    setup([product(1, "Sweet A", 100)]);

    const [row] = await getDaysOfStock(AS_OF);

    expect(row.daysWithData).toBe(0);
    expect(row.daysLeft).toBeNull();
  });

  it("treats net-negative outflow (more returned than sent) as no consumption", async () => {
    setup(
      [product(1, "Sweet A", 100)],
      [],
      offlineRows(1, { deliveryOut: 1, backloads: 9 }, 5),
    );

    const [row] = await getDaysOfStock(AS_OF);
    expect(row.averageDailyOutflow).toBe(0);
    expect(row.daysLeft).toBeNull();
  });

  it("reports zero days left - not a negative - for a product already overdrawn", async () => {
    setup([product(1, "Sweet A", -20)], onlineRows(1, 10, 5));
    expect((await getDaysOfStock(AS_OF))[0].daysLeft).toBe(0);
  });

  it("answers at exactly three days of data", async () => {
    setup([product(1, "Sweet A", 90)], onlineRows(1, 10, 3));
    expect((await getDaysOfStock(AS_OF))[0].daysLeft).toBe(9);
  });
});

describe("getDaysOfStock - restock flag and ordering", () => {
  it("flags a product at or below its threshold, and only once one is set", async () => {
    setup([
      product(1, "At threshold", 10, 10),
      product(2, "Below", 4, 10),
      product(3, "Above", 50, 10),
      product(4, "No threshold set", 0, null),
    ]);

    const byName = Object.fromEntries(
      (await getDaysOfStock(AS_OF)).map((r) => [r.name, r.needsRestock]),
    );

    expect(byName["At threshold"]).toBe(true);
    expect(byName["Below"]).toBe(true);
    expect(byName["Above"]).toBe(false);
    // Zero stock but no alert configured is not "needs restock" - that would
    // bury the card under every SKU not currently stocked.
    expect(byName["No threshold set"]).toBe(false);
  });

  it("puts products needing restock first, then the soonest to run out", async () => {
    setup(
      [
        product(1, "Plenty", 1000),
        product(2, "Urgent", 5, 10),
        product(3, "Soon", 20),
      ],
      [...onlineRows(1, 10, 5), ...onlineRows(2, 10, 5), ...onlineRows(3, 10, 5)],
    );

    expect((await getDaysOfStock(AS_OF)).map((r) => r.name)).toEqual([
      "Urgent", // needs restock
      "Soon", // 2 days
      "Plenty", // 100 days
    ]);
  });

  it("sorts products with no available rate last", async () => {
    setup([product(1, "Unknown rate", 100), product(2, "Known", 100)], onlineRows(2, 10, 5));

    expect((await getDaysOfStock(AS_OF)).map((r) => r.name)).toEqual(["Known", "Unknown rate"]);
  });

  it("queries each stock table exactly once, whatever the product count", async () => {
    setup(Array.from({ length: 200 }, (_, i) => product(i + 1, `P${i}`, 10)));

    await getDaysOfStock(AS_OF);

    expect(prisma.dailyOnlineStock.groupBy).toHaveBeenCalledTimes(1);
    expect(prisma.dailyOfflineStock.groupBy).toHaveBeenCalledTimes(1);
  });

  it("asks for a 14-day window ending on the requested date", async () => {
    setup([product(1, "Sweet A", 10)]);
    await getDaysOfStock(AS_OF);

    const where = vi.mocked(prisma.dailyOnlineStock.groupBy).mock.calls[0][0].where as {
      entryDate: { gte: Date; lte: Date };
    };
    expect(where.entryDate.lte).toEqual(AS_OF);
    expect(where.entryDate.gte).toEqual(new Date("2026-09-26T00:00:00Z"));
  });
});
