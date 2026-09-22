import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../repositories/manualCountRepository", () => ({
  manualCountRepository: {
    findOne: vi.fn(),
    upsert: vi.fn(),
    findAllForDateAndLocation: vi.fn(),
  },
}));
vi.mock("../repositories/dailyOnlineStockRepository", () => ({
  dailyOnlineStockRepository: { findByProductAndDate: vi.fn(), findAllForDate: vi.fn() },
}));
vi.mock("../repositories/dailyOfflineStockRepository", () => ({
  dailyOfflineStockRepository: { findByProductAndDate: vi.fn(), findAllForDate: vi.fn() },
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

    expect(manualCountRepository.upsert).toHaveBeenCalledWith(undefined, expect.objectContaining({ variance: 5 }));
  });

  it("is negative when the physical count is HIGHER than system stock (an overage, same sign convention everywhere else)", async () => {
    vi.mocked(dailyOnlineStockRepository.findByProductAndDate).mockResolvedValue({ remainingStock: 100 } as never);
    vi.mocked(manualCountRepository.findOne).mockResolvedValue(null);
    vi.mocked(manualCountRepository.upsert).mockImplementation(((_id: number | undefined, data: object) =>
      Promise.resolve({ id: 1, ...data })) as never);

    await saveManualCount(PRODUCT_ID, DATE, SHIFT, "ONLINE", 110);

    expect(manualCountRepository.upsert).toHaveBeenCalledWith(undefined, expect.objectContaining({ variance: -10 }));
  });
});
