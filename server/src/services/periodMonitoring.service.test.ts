import { describe, expect, it } from "vitest";
import { buildPeriodMonitoring } from "./periodMonitoring.service";

const range = { from: "2026-10-05", to: "2026-10-11", days: 7 };
const products = [
  { id: 1, sku: "A1", name: "Alpha", category: "Class A", unit: "L", sortOrder: 1 },
  { id: 2, sku: null, name: "Beta", category: "Class A", unit: "L", sortOrder: 2 },
];
const d = (s: string) => new Date(`${s}T00:00:00Z`);

describe("buildPeriodMonitoring", () => {
  it("sums flows per product and nets backloads out of Offline out", () => {
    const r = buildPeriodMonitoring(
      range,
      [{ productId: 1, _sum: { fulfillmentOut: 100, rts: 5, productionIn: 10 } }],
      [{ productId: 1, _sum: { deliveryOut: 80, upsellOut: 20, backloads: 15, productionIn: 30 } }],
      [],
      products,
    );
    expect(r.products[0]).toMatchObject({ onlineOut: 100, offlineOut: 85, totalOut: 185, backloads: 15, rts: 5, productionIn: 40 });
    expect(r.totals).toMatchObject({ totalOut: 185, backloads: 15, rts: 5, productionIn: 40 });
  });

  it("reports net and absolute variance, flagged products and counted days", () => {
    const r = buildPeriodMonitoring(
      range,
      [],
      [],
      [
        { productId: 1, entryDate: d("2026-10-06"), variance: 5 },
        { productId: 1, entryDate: d("2026-10-08"), variance: -3 },
        { productId: 2, entryDate: d("2026-10-08"), variance: 0 },
      ],
      products,
    );
    expect(r.products.find((p) => p.productId === 1)).toMatchObject({ netVariance: 2, absVariance: 8 });
    expect(r.totals).toMatchObject({ netVariance: 2, absVariance: 8, flaggedProducts: 1, countedDays: 2 });
  });

  it("returns zeros and no rows for an empty period", () => {
    const r = buildPeriodMonitoring(range, [], [], [], []);
    expect(r.products).toEqual([]);
    expect(r.totals.totalOut).toBe(0);
    expect(r.totals.countedDays).toBe(0);
  });
});

describe("getPeriodMonitoring query", () => {
  it("reads Online and Offline audit counts only, never opening balances or TOTAL counts", async () => {
    const { vi } = await import("vitest");
    vi.resetModules();
    const prismaMock = {
      dailyOnlineStock: { groupBy: vi.fn().mockResolvedValue([]) },
      dailyOfflineStock: { groupBy: vi.fn().mockResolvedValue([]) },
      manualCount: { findMany: vi.fn().mockResolvedValue([]) },
      product: { findMany: vi.fn().mockResolvedValue([]) },
    };
    vi.doMock("../lib/prisma", () => ({ prisma: prismaMock }));
    const { getPeriodMonitoring } = await import("./periodMonitoring.service.js");
    await getPeriodMonitoring(d("2026-10-05"), d("2026-10-11"));
    expect(prismaMock.manualCount.findMany.mock.calls[0][0].where).toMatchObject({
      isOpeningBalance: false,
      location: { in: ["ONLINE", "OFFLINE"] },
    });
  });
});
