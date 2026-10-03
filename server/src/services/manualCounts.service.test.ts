import { beforeEach, describe, expect, it, vi } from "vitest";

// saveManualCount/deleteManualCount now wrap themselves (and
// propagateOpeningStock) in prisma.$transaction - every repository call
// below is already mocked out regardless of which `db`/`tx` it's given, so
// the fake transaction client just needs to run the callback.
vi.mock("../lib/prisma", () => ({
  prisma: { $transaction: (cb: (tx: unknown) => unknown) => cb({}) },
}));

vi.mock("../repositories/manualCountRepository", () => ({
  manualCountRepository: {
    findOne: vi.fn(),
    upsert: vi.fn(),
    findAllForDateAndLocation: vi.fn(),
  },
}));
vi.mock("../repositories/dailyOnlineStockRepository", () => ({
  dailyOnlineStockRepository: { findByProductAndDate: vi.fn(), findAllForDate: vi.fn(), findNext: vi.fn(), getOpeningStock: vi.fn(), upsert: vi.fn() },
}));
vi.mock("../repositories/dailyOfflineStockRepository", () => ({
  dailyOfflineStockRepository: { findByProductAndDate: vi.fn(), findAllForDate: vi.fn(), findNext: vi.fn(), getOpeningStock: vi.fn(), upsert: vi.fn() },
}));
vi.mock("../repositories/productRepository", () => ({
  productRepository: { findActiveById: vi.fn(), findActive: vi.fn() },
}));
vi.mock("./changeLog.service", () => ({ recordChange: vi.fn() }));

import { manualCountRepository } from "../repositories/manualCountRepository";
import { dailyOnlineStockRepository } from "../repositories/dailyOnlineStockRepository";
import { productRepository } from "../repositories/productRepository";
import { getManualCountGrid, saveManualCount } from "./manualCounts.service";

const PRODUCT_ID = 1;
const DATE = new Date("2026-06-15T00:00:00.000Z");
const SHIFT = "NIGHT" as const;

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(productRepository.findActiveById).mockResolvedValue({ id: PRODUCT_ID, name: "Sweet A" } as never);
});

describe("getManualCountGrid - blank (not yet counted) vs. a real zero count", () => {
  it("an unsaved row reads manualCount/variance as null, never 0", async () => {
    vi.mocked(productRepository.findActive).mockResolvedValue([{ id: PRODUCT_ID, name: "Sweet A" }] as never);
    vi.mocked(manualCountRepository.findAllForDateAndLocation).mockResolvedValue([]);
    vi.mocked(dailyOnlineStockRepository.findAllForDate).mockResolvedValue([{ productId: PRODUCT_ID, remainingStock: 42 }] as never);

    const rows = await getManualCountGrid(DATE, SHIFT, "ONLINE");

    expect(rows[0].entry.manualCount).toBeNull();
    expect(rows[0].entry.variance).toBeNull();
    // The system figure is still populated even though nothing's been
    // counted yet - it's not blank, only the physical count side is.
    expect(rows[0].entry.systemRemainingStock).toBe(42);
    expect(rows[0].isSaved).toBe(false);
  });

  it("a saved count of exactly 0 is a real number, not treated as still-blank", async () => {
    vi.mocked(productRepository.findActive).mockResolvedValue([{ id: PRODUCT_ID, name: "Sweet A" }] as never);
    vi.mocked(manualCountRepository.findAllForDateAndLocation).mockResolvedValue([
      { productId: PRODUCT_ID, systemRemainingStock: 42, manualCount: 0, variance: 42 },
    ] as never);

    const rows = await getManualCountGrid(DATE, SHIFT, "ONLINE");

    expect(rows[0].entry.manualCount).toBe(0);
    expect(rows[0].isSaved).toBe(true);
    // 0 !== 42, so this genuinely is a flagged variance - not indistinguishable
    // from "not entered", which would otherwise wrongly suppress it.
    expect(rows[0].isFlagged).toBe(true);
  });
});

describe("saveManualCount - Variance = System Remaining Stock - Manual Count", () => {
  it("is positive when the physical count is LOWER than system stock (a shortage)", async () => {
    vi.mocked(dailyOnlineStockRepository.findByProductAndDate).mockResolvedValue({ remainingStock: 100 } as never);
    vi.mocked(manualCountRepository.findOne).mockResolvedValue(null);
    vi.mocked(manualCountRepository.upsert).mockImplementation(((_id: number | undefined, data: object) =>
      Promise.resolve({ id: 1, ...data })) as never);

    await saveManualCount(PRODUCT_ID, DATE, SHIFT, "ONLINE", 95);

    expect(manualCountRepository.upsert).toHaveBeenCalledWith(undefined, expect.objectContaining({ variance: 5 }), expect.anything());
  });

  it("is negative when the physical count is HIGHER than system stock (an overage, same sign convention everywhere else)", async () => {
    vi.mocked(dailyOnlineStockRepository.findByProductAndDate).mockResolvedValue({ remainingStock: 100 } as never);
    vi.mocked(manualCountRepository.findOne).mockResolvedValue(null);
    vi.mocked(manualCountRepository.upsert).mockImplementation(((_id: number | undefined, data: object) =>
      Promise.resolve({ id: 1, ...data })) as never);

    await saveManualCount(PRODUCT_ID, DATE, SHIFT, "ONLINE", 110);

    expect(manualCountRepository.upsert).toHaveBeenCalledWith(undefined, expect.objectContaining({ variance: -10 }), expect.anything());
  });
});

describe("saveManualCount - carries the count into an already-saved next period", () => {
  it("re-derives the next row's opening and remaining stock from the new count", async () => {
    vi.mocked(dailyOnlineStockRepository.findByProductAndDate).mockResolvedValue({ remainingStock: 100 } as never);
    vi.mocked(manualCountRepository.findOne).mockResolvedValue(null);
    vi.mocked(manualCountRepository.upsert).mockImplementation(((_id: number | undefined, data: object) =>
      Promise.resolve({ id: 1, ...data })) as never);
    vi.mocked(dailyOnlineStockRepository.findNext)
      .mockResolvedValueOnce({
        id: 7, entryDate: new Date("2026-06-16T00:00:00.000Z"), shift: "MORNING", openingStock: 100,
        stockInOffToOl: 0, stockOutOlToOff: 0, productionIn: 5, fulfillmentOut: 10, rts: 0, remainingStock: 95,
      } as never)
      .mockResolvedValue(null);
    vi.mocked(dailyOnlineStockRepository.getOpeningStock).mockResolvedValue(95);
    vi.mocked(dailyOnlineStockRepository.upsert).mockImplementation(((id: number, data: object) =>
      Promise.resolve({ id, ...data })) as never);

    await saveManualCount(PRODUCT_ID, DATE, SHIFT, "ONLINE", 95);

    expect(dailyOnlineStockRepository.upsert).toHaveBeenCalledWith(
      7,
      expect.objectContaining({ openingStock: 95, remainingStock: 90 }),
      expect.anything(),
    );
  });
});
