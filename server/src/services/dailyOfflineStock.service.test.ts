import { beforeEach, describe, expect, it, vi } from "vitest";
import { HttpError } from "../utils/HttpError";

vi.mock("../repositories/dailyOfflineStockRepository", () => ({
  dailyOfflineStockRepository: {
    findByProductAndDate: vi.fn(),
    getOpeningStock: vi.fn(),
    upsert: vi.fn(),
  },
}));
vi.mock("../repositories/dailyOnlineStockRepository", () => ({
  dailyOnlineStockRepository: {
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

import { dailyOfflineStockRepository } from "../repositories/dailyOfflineStockRepository";
import { dailyOnlineStockRepository } from "../repositories/dailyOnlineStockRepository";
import { productRepository } from "../repositories/productRepository";
import { saveOfflineEntry } from "./dailyOfflineStock.service";

const PRODUCT_ID = 1;
const DATE = new Date("2026-06-15T00:00:00.000Z");
const SHIFT = "NIGHT" as const;

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(productRepository.findActiveById).mockResolvedValue({ id: PRODUCT_ID, name: "Sweet A" } as never);
  vi.mocked(dailyOfflineStockRepository.findByProductAndDate).mockResolvedValue(null);
  vi.mocked(dailyOnlineStockRepository.findByProductAndDate).mockResolvedValue(null);
  // `as never` on the whole mock fn, not just its return value - Prisma's
  // real .upsert() returns its own chainable `Prisma__...Client` type
  // (extra methods like `.product()`/`.encodedBy()` for `include`), which a
  // test double has no reason to actually implement.
  vi.mocked(dailyOfflineStockRepository.upsert).mockImplementation(((_id: number | undefined, data: object) =>
    Promise.resolve({ id: 99, ...data })) as never);
  vi.mocked(dailyOnlineStockRepository.upsert).mockImplementation(((_id: number | undefined, data: object) =>
    Promise.resolve({ id: 98, ...data })) as never);
});

describe("saveOfflineEntry - Stock In/Out per channel", () => {
  it("persists Offline's own Remaining Stock when there's enough on hand (Stock In)", async () => {
    vi.mocked(dailyOfflineStockRepository.getOpeningStock).mockResolvedValue(10);

    await saveOfflineEntry(PRODUCT_ID, DATE, SHIFT, { deliveryOut: 4 });

    expect(dailyOfflineStockRepository.upsert).toHaveBeenCalledWith(
      undefined,
      expect.objectContaining({ remainingStock: 6 }),
    );
  });

  it("rejects a Stock Out that would take Offline below zero, without persisting anything", async () => {
    vi.mocked(dailyOfflineStockRepository.getOpeningStock).mockResolvedValue(10);

    await expect(saveOfflineEntry(PRODUCT_ID, DATE, SHIFT, { deliveryOut: 20 })).rejects.toThrow(HttpError);
    expect(dailyOfflineStockRepository.upsert).not.toHaveBeenCalled();
  });

  it("keeps the two channels independent - a Delivery-only save never touches Online's table", async () => {
    vi.mocked(dailyOfflineStockRepository.getOpeningStock).mockResolvedValue(10);

    await saveOfflineEntry(PRODUCT_ID, DATE, SHIFT, { deliveryOut: 2 });

    expect(dailyOnlineStockRepository.upsert).not.toHaveBeenCalled();
  });

  it("rejects a transfer that would drain Online below zero, even though Offline's own balance is fine", async () => {
    vi.mocked(dailyOfflineStockRepository.getOpeningStock).mockResolvedValue(0);
    vi.mocked(dailyOnlineStockRepository.findByProductAndDate).mockResolvedValue({
      id: 50,
      openingStock: 20,
      stockInOffToOl: 0,
      stockOutOlToOff: 0,
      productionIn: 0,
      fulfillmentOut: 0,
      rts: 0,
      encodedById: null,
    } as never);

    await expect(saveOfflineEntry(PRODUCT_ID, DATE, SHIFT, { stockInOlToOff: 50 })).rejects.toThrow(/Online stock below zero/);
  });
});
