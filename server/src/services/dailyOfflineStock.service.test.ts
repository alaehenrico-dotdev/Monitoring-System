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
vi.mock("../repositories/deliveryDestinationRepository", () => ({
  deliveryDestinationRepository: {
    findByIds: vi.fn(),
  },
}));
vi.mock("../repositories/offlineEntryDeliveryRepository", () => ({
  offlineEntryDeliveryRepository: {
    findByEntryId: vi.fn(),
    upsert: vi.fn(),
  },
}));
vi.mock("./changeLog.service", () => ({
  recordChange: vi.fn(),
}));

import { dailyOfflineStockRepository } from "../repositories/dailyOfflineStockRepository";
import { dailyOnlineStockRepository } from "../repositories/dailyOnlineStockRepository";
import { deliveryDestinationRepository } from "../repositories/deliveryDestinationRepository";
import { offlineEntryDeliveryRepository } from "../repositories/offlineEntryDeliveryRepository";
import { productRepository } from "../repositories/productRepository";
import { recordChange } from "./changeLog.service";
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
  vi.mocked(dailyOfflineStockRepository.upsert).mockImplementation(((id: number | undefined, data: object) =>
    Promise.resolve({ id: id ?? 99, ...data })) as never);
  vi.mocked(dailyOnlineStockRepository.upsert).mockImplementation(((_id: number | undefined, data: object) =>
    Promise.resolve({ id: 98, ...data })) as never);
  vi.mocked(offlineEntryDeliveryRepository.findByEntryId).mockResolvedValue([]);
  vi.mocked(offlineEntryDeliveryRepository.upsert).mockResolvedValue({} as never);
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

describe("saveOfflineEntry - per-destination Delivery (Out) breakdown", () => {
  it("sums ALL destinations (not just the one in this request) into deliveryOut/remainingStock", async () => {
    vi.mocked(dailyOfflineStockRepository.getOpeningStock).mockResolvedValue(100);
    vi.mocked(dailyOfflineStockRepository.findByProductAndDate).mockResolvedValue({
      id: 7,
      openingStock: 100,
      deliveryOut: 999, // stale column value - must be ignored in favor of the breakdown sum
    } as never);
    vi.mocked(deliveryDestinationRepository.findByIds).mockResolvedValue([{ id: 2, name: "East" }] as never);
    // East already has 5 on file from a previous save; this request only changes destination 2.
    vi.mocked(offlineEntryDeliveryRepository.findByEntryId).mockResolvedValue([
      { destinationId: 1, quantity: 20 },
      { destinationId: 2, quantity: 5 },
    ] as never);

    await saveOfflineEntry(PRODUCT_ID, DATE, SHIFT, { deliveryByDestination: { "2": 8 } });

    // 20 (untouched West) + 8 (new East) = 28, not 999 and not just 8.
    expect(dailyOfflineStockRepository.upsert).toHaveBeenCalledWith(7, expect.objectContaining({ deliveryOut: 28, remainingStock: 72 }));
    expect(offlineEntryDeliveryRepository.upsert).toHaveBeenCalledWith(7, 2, 8);
    expect(offlineEntryDeliveryRepository.upsert).toHaveBeenCalledTimes(1);
  });

  it("logs a synthetic deliveryOut:<destination name> field, old -> new, for each changed destination", async () => {
    vi.mocked(dailyOfflineStockRepository.getOpeningStock).mockResolvedValue(100);
    vi.mocked(dailyOfflineStockRepository.findByProductAndDate).mockResolvedValue({ id: 7, openingStock: 100, deliveryOut: 5 } as never);
    vi.mocked(deliveryDestinationRepository.findByIds).mockResolvedValue([{ id: 2, name: "East" }] as never);
    vi.mocked(offlineEntryDeliveryRepository.findByEntryId).mockResolvedValue([{ destinationId: 2, quantity: 5 }] as never);

    await saveOfflineEntry(PRODUCT_ID, DATE, SHIFT, { deliveryByDestination: { "2": 8 } });

    expect(recordChange).toHaveBeenCalledWith(
      expect.objectContaining({
        oldValue: expect.objectContaining({ "deliveryOut:East": 5 }),
        newValue: expect.objectContaining({ "deliveryOut:East": 8 }),
      }),
    );
  });

  it("rejects an unknown destination id without persisting anything", async () => {
    vi.mocked(dailyOfflineStockRepository.getOpeningStock).mockResolvedValue(100);
    vi.mocked(deliveryDestinationRepository.findByIds).mockResolvedValue([]);

    await expect(saveOfflineEntry(PRODUCT_ID, DATE, SHIFT, { deliveryByDestination: { "999": 3 } })).rejects.toThrow(
      /Unknown delivery destination/,
    );
    expect(dailyOfflineStockRepository.upsert).not.toHaveBeenCalled();
    expect(offlineEntryDeliveryRepository.upsert).not.toHaveBeenCalled();
  });

  it("a flat deliveryOut (no breakdown) never touches OfflineEntryDelivery rows - CSV-import backward compat", async () => {
    vi.mocked(dailyOfflineStockRepository.getOpeningStock).mockResolvedValue(100);

    await saveOfflineEntry(PRODUCT_ID, DATE, SHIFT, { deliveryOut: 15 });

    expect(dailyOfflineStockRepository.upsert).toHaveBeenCalledWith(undefined, expect.objectContaining({ deliveryOut: 15 }));
    expect(offlineEntryDeliveryRepository.upsert).not.toHaveBeenCalled();
    expect(deliveryDestinationRepository.findByIds).not.toHaveBeenCalled();
  });
});
