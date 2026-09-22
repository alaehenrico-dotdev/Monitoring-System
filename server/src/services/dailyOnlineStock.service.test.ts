import { beforeEach, describe, expect, it, vi } from "vitest";
import { HttpError } from "../utils/HttpError";

vi.mock("../repositories/dailyOnlineStockRepository", () => ({
  dailyOnlineStockRepository: {
    findByProductAndDate: vi.fn(),
    getOpeningStock: vi.fn(),
    upsert: vi.fn(),
  },
}));
vi.mock("../repositories/dailyOfflineStockRepository", () => ({
  dailyOfflineStockRepository: {
    findByProductAndDate: vi.fn(),
    getOpeningStock: vi.fn(),
    upsert: vi.fn(),
  },
}));
vi.mock("../repositories/productRepository", () => ({
  productRepository: {
    findActiveById: vi.fn(),
  },
}));
vi.mock("./changeLog.service", () => ({
  recordChange: vi.fn(),
}));

import { dailyOnlineStockRepository } from "../repositories/dailyOnlineStockRepository";
import { dailyOfflineStockRepository } from "../repositories/dailyOfflineStockRepository";
import { productRepository } from "../repositories/productRepository";
import { saveOnlineEntry } from "./dailyOnlineStock.service";

const PRODUCT_ID = 1;
const DATE = new Date("2026-06-15T00:00:00.000Z");
const SHIFT = "NIGHT" as const;

// Every scenario below saves a product with no existing Online row and no
// existing Offline row unless a test overrides it - keeps each test's own
// setup limited to just what it's actually exercising.
beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(productRepository.findActiveById).mockResolvedValue({ id: PRODUCT_ID, name: "Sweet A" } as never);
  vi.mocked(dailyOnlineStockRepository.findByProductAndDate).mockResolvedValue(null);
  vi.mocked(dailyOfflineStockRepository.findByProductAndDate).mockResolvedValue(null);
  // `as never` on the whole mock fn, not just its return value - Prisma's
  // real .upsert() returns its own chainable `Prisma__...Client` type
  // (extra methods like `.product()`/`.encodedBy()` for `include`), which a
  // test double has no reason to actually implement.
  vi.mocked(dailyOnlineStockRepository.upsert).mockImplementation(((_id: number | undefined, data: object) =>
    Promise.resolve({ id: 99, ...data })) as never);
  vi.mocked(dailyOfflineStockRepository.upsert).mockImplementation(((_id: number | undefined, data: object) =>
    Promise.resolve({ id: 98, ...data })) as never);
});

describe("saveOnlineEntry - Stock In/Out per channel", () => {
  it("persists Online's own Remaining Stock when there's enough on hand (Stock In)", async () => {
    vi.mocked(dailyOnlineStockRepository.getOpeningStock).mockResolvedValue(10);

    await saveOnlineEntry(PRODUCT_ID, DATE, SHIFT, { fulfillmentOut: 5 });

    expect(dailyOnlineStockRepository.upsert).toHaveBeenCalledWith(
      undefined,
      expect.objectContaining({ remainingStock: 5 }),
    );
  });

  it("rejects a Stock Out that would take Online below zero, without persisting anything", async () => {
    vi.mocked(dailyOnlineStockRepository.getOpeningStock).mockResolvedValue(10);

    await expect(saveOnlineEntry(PRODUCT_ID, DATE, SHIFT, { fulfillmentOut: 15 })).rejects.toThrow(HttpError);
    expect(dailyOnlineStockRepository.upsert).not.toHaveBeenCalled();
  });

  it("keeps the two channels independent - a Fulfillment-only save never touches Offline's table", async () => {
    vi.mocked(dailyOnlineStockRepository.getOpeningStock).mockResolvedValue(10);

    await saveOnlineEntry(PRODUCT_ID, DATE, SHIFT, { fulfillmentOut: 3 });

    // No transfer fields changed (both default to 0, matching what a
    // nonexistent Offline row would also mirror as) - the mirror's own
    // no-op guard means Offline is never written to.
    expect(dailyOfflineStockRepository.upsert).not.toHaveBeenCalled();
  });

  it("still saves a transfer that drains the OTHER channel below zero, so the shortfall reflects in variance reports", async () => {
    // Online is only receiving stock here, so its own Remaining Stock is
    // trivially non-negative - the real constraint would be on Offline,
    // which is what's actually giving up the 50 units being pulled in. That
    // no longer blocks the save: the mirrored Offline row is persisted with
    // its negative Remaining Stock as-is instead of rejecting the write.
    vi.mocked(dailyOnlineStockRepository.getOpeningStock).mockResolvedValue(0);
    vi.mocked(dailyOfflineStockRepository.findByProductAndDate).mockResolvedValue({
      id: 50,
      openingStock: 20,
      stockInOlToOff: 0,
      stockOutOffToOl: 0,
      productionIn: 0,
      deliveryOut: 0,
      backloads: 0,
      encodedById: null,
    } as never);

    await saveOnlineEntry(PRODUCT_ID, DATE, SHIFT, { stockInOffToOl: 50 });

    expect(dailyOfflineStockRepository.upsert).toHaveBeenCalledWith(
      50,
      expect.objectContaining({ remainingStock: -30 }),
    );
  });
});
