import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../lib/prisma", () => ({
  prisma: {
    dailyOnlineStock: { groupBy: vi.fn() },
    dailyOfflineStock: { groupBy: vi.fn() },
  },
}));

import { prisma } from "../lib/prisma";
import { getStockFlow } from "./stockFlow.service";

const d = (s: string) => new Date(`${s}T00:00:00Z`);

beforeEach(() => {
  vi.mocked(prisma.dailyOnlineStock.groupBy).mockReset();
  vi.mocked(prisma.dailyOfflineStock.groupBy).mockReset();
});

function seed(on: unknown[], off: unknown[]) {
  vi.mocked(prisma.dailyOnlineStock.groupBy).mockResolvedValue(on as never);
  vi.mocked(prisma.dailyOfflineStock.groupBy).mockResolvedValue(off as never);
}

describe("getStockFlow", () => {
  it("returns every date in order, leaving a day nobody encoded empty rather than zero", async () => {
    seed(
      [{ entryDate: d("2026-10-01"), _sum: { productionIn: 10, fulfillmentOut: 40 } }],
      [{ entryDate: d("2026-10-03"), _sum: { productionIn: 5, deliveryOut: 20 } }],
    );
    const rows = await getStockFlow(d("2026-10-01"), d("2026-10-03"));
    expect(rows.map((r) => r.date)).toEqual(["2026-10-01", "2026-10-02", "2026-10-03"]);
    expect(rows[1]).toEqual({ date: "2026-10-02", production: null, fulfillment: null, delivery: null });
  });

  it("adds Online and Offline production and keeps a side with no entry null", async () => {
    seed(
      [{ entryDate: d("2026-10-01"), _sum: { productionIn: 10, fulfillmentOut: 40 } }],
      [{ entryDate: d("2026-10-01"), _sum: { productionIn: 5, deliveryOut: 20 } }],
    );
    const [both] = await getStockFlow(d("2026-10-01"), d("2026-10-01"));
    expect(both).toEqual({ date: "2026-10-01", production: 15, fulfillment: 40, delivery: 20 });

    seed([{ entryDate: d("2026-10-01"), _sum: { productionIn: 10, fulfillmentOut: 40 } }], []);
    const [onlyOnline] = await getStockFlow(d("2026-10-01"), d("2026-10-01"));
    expect(onlyOnline).toEqual({ date: "2026-10-01", production: 10, fulfillment: 40, delivery: null });
  });
});
