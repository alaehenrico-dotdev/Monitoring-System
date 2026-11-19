import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../lib/prisma", () => ({
  prisma: {
    dailyOnlineStock: { findMany: vi.fn() },
    dailyOfflineStock: { findMany: vi.fn() },
  },
}));

import { prisma } from "../lib/prisma";
import { findStockDrift } from "./reconcile.service";

const TODAY = new Date("2026-11-19T00:00:00Z");
const base = { productId: 1, entryDate: TODAY, shift: "NIGHT", product: { name: "Sauce" } };

const online = (o: Record<string, number> = {}) => ({
  ...base,
  openingStock: 10, stockInOffToOl: 5, stockOutOlToOff: 0, onlineStock: 15,
  productionIn: 0, fulfillmentOut: 3, rts: 0, remainingStock: 12,
  ...o,
});
const offline = (o: Record<string, number> = {}) => ({
  ...base,
  openingStock: 20, stockInOlToOff: 0, stockOutOffToOl: 5, offlineStock: 15,
  productionIn: 0, delivery1: 4, delivery2: 0, delivery3: 0, delivery4: 0, delivery5: 0, deliveryOut: 4,
  backloads: 0, upsellOut: 0, remainingStock: 11,
  ...o,
});

describe("findStockDrift", () => {
  beforeEach(() => vi.clearAllMocks());
  const setup = (on: unknown[], off: unknown[]) => {
    vi.mocked(prisma.dailyOnlineStock.findMany).mockResolvedValue(on as never);
    vi.mocked(prisma.dailyOfflineStock.findMany).mockResolvedValue(off as never);
  };

  it("reports nothing when every figure adds up and the transfers mirror", async () => {
    setup([online()], [offline()]);
    expect(await findStockDrift(TODAY)).toEqual([]);
  });

  it("flags a stored Remaining that does not match its inputs", async () => {
    setup([online({ remainingStock: 99 })], []);
    const drift = await findStockDrift(TODAY);
    expect(drift).toHaveLength(1);
    expect(drift[0]).toMatchObject({ location: "ONLINE", name: "Sauce", date: "2026-11-19" });
  });

  it("flags a delivery total below its slots and a one-sided transfer", async () => {
    setup([online({ stockInOffToOl: 5 })], [offline({ delivery1: 9, deliveryOut: 4, stockOutOffToOl: 2, offlineStock: 18, remainingStock: 5 })]);
    const problems = (await findStockDrift(TODAY)).map((d) => d.problem).join(" | ");
    expect(problems).toMatch(/Delivery total/);
    expect(problems).toMatch(/Offline sent 2 to Online, Online received 5/);
  });
});
