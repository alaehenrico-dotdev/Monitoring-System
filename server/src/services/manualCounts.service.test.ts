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
    findOneWithCounter: vi.fn(),
    updateRemarks: vi.fn(),
    findLatestBefore: vi.fn(),
    findUnpublishedForPeriod: vi.fn(),
    markPublished: vi.fn(),
  },
}));
vi.mock("../repositories/changeLogRepository", () => ({
  changeLogRepository: { findForRecord: vi.fn() },
}));
vi.mock("../repositories/userRepository", () => ({
  userRepository: { findById: vi.fn() },
}));
vi.mock("../repositories/dailyOnlineStockRepository", () => ({
  dailyOnlineStockRepository: {
    findByProductAndDate: vi.fn(),
    findAllForDate: vi.fn(),
    findNext: vi.fn(),
    getOpeningStock: vi.fn(),
    getOpeningStocksForProducts: vi.fn(),
    upsert: vi.fn(),
  },
}));
vi.mock("../repositories/dailyOfflineStockRepository", () => ({
  dailyOfflineStockRepository: {
    findByProductAndDate: vi.fn(),
    findAllForDate: vi.fn(),
    findNext: vi.fn(),
    getOpeningStock: vi.fn(),
    getOpeningStocksForProducts: vi.fn(),
    upsert: vi.fn(),
  },
}));
vi.mock("../repositories/productRepository", () => ({
  productRepository: { findActiveById: vi.fn(), findActive: vi.fn() },
}));
vi.mock("./changeLog.service", () => ({ recordChange: vi.fn() }));

import { manualCountRepository } from "../repositories/manualCountRepository";
import { dailyOnlineStockRepository } from "../repositories/dailyOnlineStockRepository";
import { dailyOfflineStockRepository } from "../repositories/dailyOfflineStockRepository";
import { productRepository } from "../repositories/productRepository";
import { changeLogRepository } from "../repositories/changeLogRepository";
import { userRepository } from "../repositories/userRepository";
import { recordChange } from "./changeLog.service";
import { getManualCountGrid, getVarianceReport, getVarianceTrace, publishManualCounts, saveManualCount, setCountRemarks } from "./manualCounts.service";

const PRODUCT_ID = 1;
const DATE = new Date("2026-06-15T00:00:00.000Z");
const SHIFT = "NIGHT" as const;

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(productRepository.findActiveById).mockResolvedValue({ id: PRODUCT_ID, name: "Sweet A" } as never);
  vi.mocked(dailyOnlineStockRepository.getOpeningStocksForProducts).mockResolvedValue(new Map());
  vi.mocked(dailyOfflineStockRepository.getOpeningStocksForProducts).mockResolvedValue(new Map());
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

describe("getManualCountGrid - opening-stock continuity", () => {
  beforeEach(() => {
    vi.mocked(productRepository.findActive).mockResolvedValue([{ id: PRODUCT_ID, name: "Sweet A" }] as never);
    vi.mocked(manualCountRepository.findAllForDateAndLocation).mockResolvedValue([]);
  });

  it("flags a saved period whose opening is not what the previous period carries forward", async () => {
    vi.mocked(dailyOnlineStockRepository.findAllForDate).mockResolvedValue([{ productId: PRODUCT_ID, openingStock: 80, remainingStock: 80 }] as never);
    vi.mocked(dailyOnlineStockRepository.getOpeningStocksForProducts).mockResolvedValue(new Map([[PRODUCT_ID, 100]]));

    const rows = await getManualCountGrid(DATE, SHIFT, "ONLINE");

    expect(rows[0].openingBreak).toEqual({ expected: 100, actual: 80 });
  });

  it("is quiet when the opening carries forward correctly", async () => {
    vi.mocked(dailyOnlineStockRepository.findAllForDate).mockResolvedValue([{ productId: PRODUCT_ID, openingStock: "100.00", remainingStock: 100 }] as never);
    vi.mocked(dailyOnlineStockRepository.getOpeningStocksForProducts).mockResolvedValue(new Map([[PRODUCT_ID, 100]]));

    expect((await getManualCountGrid(DATE, SHIFT, "ONLINE"))[0].openingBreak).toBeNull();
  });

  it("has nothing to compare for a period with no saved entry, or for a TOTAL grid", async () => {
    vi.mocked(dailyOnlineStockRepository.findAllForDate).mockResolvedValue([]);
    vi.mocked(dailyOfflineStockRepository.findAllForDate).mockResolvedValue([]);
    vi.mocked(dailyOnlineStockRepository.getOpeningStock).mockResolvedValue(0);

    expect((await getManualCountGrid(DATE, SHIFT, "ONLINE"))[0].openingBreak).toBeNull();
    expect((await getManualCountGrid(DATE, SHIFT, "TOTAL"))[0].openingBreak).toBeNull();
  });
});

describe("setCountRemarks", () => {
  const existing = { id: 9, productId: PRODUCT_ID, remarks: null, manualCount: 5, variance: 3 };

  it("saves trimmed remarks on a saved count and logs the change", async () => {
    vi.mocked(manualCountRepository.findOne).mockResolvedValue(existing as never);
    vi.mocked(manualCountRepository.updateRemarks).mockResolvedValue({ ...existing, remarks: "Damaged in transit" } as never);

    await setCountRemarks(PRODUCT_ID, DATE, SHIFT, "ONLINE", "  Damaged in transit  ", 7);

    expect(manualCountRepository.updateRemarks).toHaveBeenCalledWith(9, "Damaged in transit", expect.anything());
    expect(recordChange).toHaveBeenCalledWith(
      expect.objectContaining({ tableName: "manual_counts", recordId: 9, action: "UPDATE", changedById: 7, oldValue: existing }),
      expect.anything(),
    );
  });

  it("clears them with an empty string", async () => {
    vi.mocked(manualCountRepository.findOne).mockResolvedValue({ ...existing, remarks: "old" } as never);
    vi.mocked(manualCountRepository.updateRemarks).mockResolvedValue({ ...existing, remarks: null } as never);

    await setCountRemarks(PRODUCT_ID, DATE, SHIFT, "ONLINE", "   ", 7);

    expect(manualCountRepository.updateRemarks).toHaveBeenCalledWith(9, null, expect.anything());
  });

  it("does nothing, and logs nothing, when the text is unchanged", async () => {
    vi.mocked(manualCountRepository.findOne).mockResolvedValue({ ...existing, remarks: "same" } as never);

    await setCountRemarks(PRODUCT_ID, DATE, SHIFT, "ONLINE", "same", 7);

    expect(manualCountRepository.updateRemarks).not.toHaveBeenCalled();
    expect(recordChange).not.toHaveBeenCalled();
  });

  it("refuses remarks on a count that has not been saved", async () => {
    vi.mocked(manualCountRepository.findOne).mockResolvedValue(null);
    await expect(setCountRemarks(PRODUCT_ID, DATE, SHIFT, "ONLINE", "why", 7)).rejects.toMatchObject({ status: 404 });
  });

  it("refuses remarks that are too long", async () => {
    await expect(setCountRemarks(PRODUCT_ID, DATE, SHIFT, "ONLINE", "x".repeat(501), 7)).rejects.toMatchObject({ status: 400 });
  });
});

describe("getVarianceTrace", () => {
  const entry = { id: 50, openingStock: 100, productionIn: 20, fulfillmentOut: 15, remainingStock: 105, encodedById: 4 };
  const count = {
    id: 60,
    manualCount: 100,
    systemRemainingStock: 105,
    variance: 5,
    remarks: "Spoilage",
    countedBy: { name: "Ana" },
    updatedAt: new Date("2026-06-15T20:00:00Z"),
  };
  const log = (over: object) => ({ action: "UPDATE", oldValue: null, newValue: null, causedById: null, changedBy: { name: "Ben" }, ...over });

  beforeEach(() => {
    vi.mocked(manualCountRepository.findOneWithCounter).mockResolvedValue(count as never);
    vi.mocked(dailyOnlineStockRepository.findByProductAndDate).mockResolvedValue(entry as never);
    vi.mocked(dailyOnlineStockRepository.getOpeningStock).mockResolvedValue(100);
    vi.mocked(manualCountRepository.findLatestBefore).mockResolvedValue(null);
    vi.mocked(userRepository.findById).mockResolvedValue({ name: "Cleo" } as never);
  });

  it("gathers the count, counter, opening and the movements behind the system figure", async () => {
    vi.mocked(changeLogRepository.findForRecord).mockResolvedValue([]);

    const t = await getVarianceTrace(PRODUCT_ID, DATE, SHIFT, "ONLINE");

    expect(t.count).toMatchObject({ manualCount: 100, systemRemainingStock: 105, variance: 5, remarks: "Spoilage", countedBy: "Ana" });
    expect(t.encodedBy).toBe("Cleo");
    expect(t.opening).toEqual({ expected: 100, actual: 100, isBreak: false, source: "system" });
    expect(t.figures).toEqual(
      expect.arrayContaining([
        { label: "Opening stock", value: "100" },
        { label: "Production in", value: "20" },
        { label: "Fulfillment out", value: "15" },
      ]),
    );
  });

  it("reports an opening that broke the carry-forward", async () => {
    vi.mocked(changeLogRepository.findForRecord).mockResolvedValue([]);
    vi.mocked(dailyOnlineStockRepository.getOpeningStock).mockResolvedValue(130);

    const t = await getVarianceTrace(PRODUCT_ID, DATE, SHIFT, "ONLINE");

    expect(t.opening).toMatchObject({ expected: 130, actual: 100, isBreak: true });
  });

  it("names the previous period's count as the opening's source when it is the immediate predecessor", async () => {
    vi.mocked(changeLogRepository.findForRecord).mockResolvedValue([]);
    vi.mocked(manualCountRepository.findLatestBefore).mockResolvedValue({ entryDate: DATE, shift: "MORNING", manualCount: 100 } as never);

    expect((await getVarianceTrace(PRODUCT_ID, DATE, SHIFT, "ONLINE")).opening.source).toBe("count");
  });

  it("merges entry and count history newest first, marking edits made after the count and automatic ones", async () => {
    vi.mocked(changeLogRepository.findForRecord).mockImplementation(((table: string) =>
      Promise.resolve(
        table === "manual_counts"
          ? [log({ changedAt: new Date("2026-06-15T20:00:00Z"), changedBy: { name: "Ana" }, oldValue: { manualCount: 90 }, newValue: { manualCount: 100 } })]
          : [
              log({ changedAt: new Date("2026-06-15T21:00:00Z"), oldValue: { fulfillmentOut: 10 }, newValue: { fulfillmentOut: 15 } }),
              log({ changedAt: new Date("2026-06-15T12:00:00Z"), causedById: 3, oldValue: { openingStock: 90 }, newValue: { openingStock: 100 } }),
            ],
      )) as never);

    const t = await getVarianceTrace(PRODUCT_ID, DATE, SHIFT, "ONLINE");

    expect(t.history.map((h) => [h.what, h.who, h.auto, h.afterCount])).toEqual([
      ["Entry", "Ben", false, true],
      ["Count", "Ana", false, false],
      ["Entry", "Ben", true, false],
    ]);
    expect(t.history[0].summary).toBe("Fulfillment out 10 → 15");
  });

  it("works for a period with no saved entry and no count", async () => {
    vi.mocked(manualCountRepository.findOneWithCounter).mockResolvedValue(null);
    vi.mocked(dailyOnlineStockRepository.findByProductAndDate).mockResolvedValue(null);
    vi.mocked(changeLogRepository.findForRecord).mockResolvedValue([]);

    const t = await getVarianceTrace(PRODUCT_ID, DATE, SHIFT, "ONLINE");

    expect(t.count).toBeNull();
    expect(t.entrySaved).toBe(false);
    expect(t.history).toEqual([]);
  });
});

describe("saveManualCount - follow-on changes name their cause", () => {
  it("stamps the carried-forward opening-stock rewrite with the change that triggered it", async () => {
    vi.mocked(dailyOnlineStockRepository.findByProductAndDate).mockResolvedValue({ remainingStock: 100 } as never);
    vi.mocked(manualCountRepository.findOne).mockResolvedValue(null);
    vi.mocked(manualCountRepository.upsert).mockImplementation(((_id: number | undefined, data: object) => Promise.resolve({ id: 1, ...data })) as never);
    vi.mocked(recordChange).mockResolvedValueOnce(77);
    // A later saved period still carrying the old opening (100) while the count says 95.
    const next = { id: 5, entryDate: new Date("2026-06-16T00:00:00.000Z"), shift: "MORNING", openingStock: 100, stockInOffToOl: 0, stockOutOlToOff: 0, productionIn: 0, fulfillmentOut: 0, rts: 0 };
    vi.mocked(dailyOnlineStockRepository.findNext).mockResolvedValueOnce(next as never).mockResolvedValue(null);
    vi.mocked(dailyOnlineStockRepository.getOpeningStock).mockResolvedValue(95);
    vi.mocked(dailyOnlineStockRepository.upsert).mockResolvedValue({ ...next, openingStock: 95 } as never);

    await saveManualCount(PRODUCT_ID, DATE, SHIFT, "ONLINE", 95, 7);

    const calls = vi.mocked(recordChange).mock.calls.map((c) => c[0]);
    expect(calls[0]).toMatchObject({ tableName: "manual_counts" });
    expect(calls[0].causedById).toBeUndefined();
    expect(calls[1]).toMatchObject({ tableName: "daily_online_stock", recordId: 5, causedById: 77 });
  });
});

describe("getVarianceReport - range limit", () => {
  it("refuses a range longer than a year, so one request cannot read every count", async () => {
    await expect(
      getVarianceReport({ startDate: new Date("2024-01-01T00:00:00Z"), endDate: new Date("2026-01-01T00:00:00Z") }),
    ).rejects.toMatchObject({ status: 400 });
  });
});

describe("publishing counts", () => {
  const pending = (id: number, productId: number, location: "ONLINE" | "OFFLINE") => ({ id, productId, location, manualCount: 5, publishedAt: null });

  it("an edited count goes back to unpublished, so only approved figures carry forward", async () => {
    vi.mocked(dailyOnlineStockRepository.findByProductAndDate).mockResolvedValue({ remainingStock: 100 } as never);
    vi.mocked(manualCountRepository.findOne).mockResolvedValue({ id: 1, publishedAt: new Date() } as never);
    vi.mocked(manualCountRepository.upsert).mockImplementation(((_id: number | undefined, data: object) => Promise.resolve({ id: 1, ...data })) as never);

    await saveManualCount(PRODUCT_ID, DATE, SHIFT, "ONLINE", 90, 7);

    expect(vi.mocked(manualCountRepository.upsert).mock.calls[0][1]).toMatchObject({ publishedAt: null, publishedById: null });
  });

  it("publishes every waiting count on the sheet, logs each, and pushes them into the next period", async () => {
    vi.mocked(manualCountRepository.findUnpublishedForPeriod).mockResolvedValue([pending(1, 10, "ONLINE"), pending(2, 11, "OFFLINE")] as never);
    vi.mocked(manualCountRepository.markPublished).mockImplementation(((id: number) => Promise.resolve({ id, publishedAt: new Date() })) as never);
    vi.mocked(recordChange).mockResolvedValueOnce(101).mockResolvedValueOnce(102);
    // A later saved Online period for product 10 still holds the old opening.
    const next = { id: 9, entryDate: new Date("2026-06-16T00:00:00.000Z"), shift: "MORNING", openingStock: 100, stockInOffToOl: 0, stockOutOlToOff: 0, productionIn: 0, fulfillmentOut: 0, rts: 0 };
    vi.mocked(dailyOnlineStockRepository.findNext).mockResolvedValueOnce(next as never).mockResolvedValue(null);
    vi.mocked(dailyOnlineStockRepository.getOpeningStock).mockResolvedValue(95);
    vi.mocked(dailyOnlineStockRepository.upsert).mockResolvedValue({ ...next, openingStock: 95 } as never);
    vi.mocked(manualCountRepository.findOne).mockResolvedValue(null);

    const out = await publishManualCounts(DATE, SHIFT, 7);

    expect(out.published).toBe(2);
    expect(manualCountRepository.markPublished).toHaveBeenCalledWith(1, 7, expect.any(Date), expect.anything());
    const calls = vi.mocked(recordChange).mock.calls.map((c) => c[0]);
    expect(calls[0]).toMatchObject({ tableName: "manual_counts", recordId: 1, action: "UPDATE", changedById: 7 });
    // The re-derived opening on the later period names the publish as its cause.
    expect(calls.find((c) => c.tableName === "daily_online_stock")).toMatchObject({ recordId: 9, causedById: 101 });
  });

  it("refuses when nothing is waiting", async () => {
    vi.mocked(manualCountRepository.findUnpublishedForPeriod).mockResolvedValue([]);
    await expect(publishManualCounts(DATE, SHIFT, 7)).rejects.toMatchObject({ status: 400 });
    expect(recordChange).not.toHaveBeenCalled();
  });
});
