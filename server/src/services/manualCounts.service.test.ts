import { beforeEach, describe, expect, it, vi } from "vitest";

// saveManualCount/deleteManualCount now wrap themselves (and
// propagateOpeningStock) in prisma.$transaction - every repository call
// below is already mocked out regardless of which `db`/`tx` it's given, so
// the fake transaction client just needs to run the callback.
// publishing also stores a frozen copy of what it released (tx.auditSnapshot) and
// reads the products' names for it (tx.product).
const snapshotTx = vi.hoisted(() => ({
  product: { findMany: vi.fn() },
  auditSnapshot: { create: vi.fn(), findUnique: vi.fn(), findMany: vi.fn(), update: vi.fn() },
  manualCount: { findMany: vi.fn(), update: vi.fn() },
}));
vi.mock("../lib/prisma", () => ({
  prisma: { $transaction: (cb: (tx: unknown) => unknown) => cb(snapshotTx), auditSnapshot: snapshotTx.auditSnapshot, manualCount: snapshotTx.manualCount },
}));
const recordReportHistoryIn = vi.hoisted(() => vi.fn());
vi.mock("./reportHistory.service", () => ({ recordReportHistoryIn }));

vi.mock("../repositories/manualCountRepository", () => ({
  manualCountRepository: {
    findOne: vi.fn(),
    hasAnyCount: vi.fn(),
    productIdsWithCounts: vi.fn(),
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
    productIdsWithRowsAfterDate: vi.fn(),
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
    productIdsWithRowsAfterDate: vi.fn(),
    upsert: vi.fn(),
  },
}));
vi.mock("../repositories/productRepository", () => ({
  productRepository: { findActiveById: vi.fn(), findActive: vi.fn() },
}));
vi.mock("./dayLock.service", () => ({ assertPeriodOpen: vi.fn(), isLockedForCarry: vi.fn().mockResolvedValue(false) }));
vi.mock("./changeLog.service", () => ({ recordChange: vi.fn(), logSystemEvent: vi.fn() }));

import { manualCountRepository } from "../repositories/manualCountRepository";
import { dailyOnlineStockRepository } from "../repositories/dailyOnlineStockRepository";
import { dailyOfflineStockRepository } from "../repositories/dailyOfflineStockRepository";
import { productRepository } from "../repositories/productRepository";
import { changeLogRepository } from "../repositories/changeLogRepository";
import { userRepository } from "../repositories/userRepository";
import { recordChange } from "./changeLog.service";
import { getAuditSnapshot, getAuditSnapshotStates, revertAuditSnapshot, getManualCountGrid, getVarianceReport, getVarianceTrace, publishManualCounts, saveManualCount, setCountRemarks } from "./manualCounts.service";

const PRODUCT_ID = 1;
const DATE = new Date("2026-06-15T00:00:00.000Z");
const SHIFT = "NIGHT" as const;

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(productRepository.findActiveById).mockResolvedValue({ id: PRODUCT_ID, name: "Sweet A" } as never);
  vi.mocked(dailyOnlineStockRepository.getOpeningStocksForProducts).mockResolvedValue(new Map());
  vi.mocked(dailyOfflineStockRepository.getOpeningStocksForProducts).mockResolvedValue(new Map());
  // By default the product already has counts, so a save is a normal audit
  // count; the opening-balance tests below override this.
  vi.mocked(manualCountRepository.hasAnyCount).mockResolvedValue(true);
  vi.mocked(manualCountRepository.productIdsWithCounts).mockResolvedValue(new Set([PRODUCT_ID]));
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

describe("saveManualCount - Variance = Manual Count - System Remaining Stock", () => {
  it("is negative when the physical count is LOWER than system stock (a shortage)", async () => {
    vi.mocked(dailyOnlineStockRepository.findByProductAndDate).mockResolvedValue({ remainingStock: 100 } as never);
    vi.mocked(manualCountRepository.findOne).mockResolvedValue(null);
    vi.mocked(manualCountRepository.upsert).mockImplementation(((_id: number | undefined, data: object) =>
      Promise.resolve({ id: 1, ...data })) as never);

    await saveManualCount(PRODUCT_ID, DATE, SHIFT, "ONLINE", 95);

    expect(manualCountRepository.upsert).toHaveBeenCalledWith(undefined, expect.objectContaining({ variance: -5 }), expect.anything());
  });

  it("is positive when the physical count is HIGHER than system stock (an overage, same sign convention everywhere else)", async () => {
    vi.mocked(dailyOnlineStockRepository.findByProductAndDate).mockResolvedValue({ remainingStock: 100 } as never);
    vi.mocked(manualCountRepository.findOne).mockResolvedValue(null);
    vi.mocked(manualCountRepository.upsert).mockImplementation(((_id: number | undefined, data: object) =>
      Promise.resolve({ id: 1, ...data })) as never);

    await saveManualCount(PRODUCT_ID, DATE, SHIFT, "ONLINE", 110);

    expect(manualCountRepository.upsert).toHaveBeenCalledWith(undefined, expect.objectContaining({ variance: 10 }), expect.anything());
  });
});

describe("saveManualCount - counts are an audit only", () => {
  it("never rewrites the next period's opening or remaining stock", async () => {
    vi.mocked(dailyOnlineStockRepository.findByProductAndDate).mockResolvedValue({ remainingStock: 100 } as never);
    vi.mocked(manualCountRepository.findOne).mockResolvedValue(null);
    vi.mocked(manualCountRepository.upsert).mockImplementation(((_id: number | undefined, data: object) =>
      Promise.resolve({ id: 1, ...data })) as never);

    await saveManualCount(PRODUCT_ID, DATE, SHIFT, "ONLINE", 95, 7);

    expect(dailyOnlineStockRepository.findNext).not.toHaveBeenCalled();
    expect(dailyOnlineStockRepository.upsert).not.toHaveBeenCalled();
    // Only the count itself is logged - no follow-on opening-stock rewrite.
    expect(vi.mocked(recordChange).mock.calls.map((c) => c[0].tableName)).toEqual(["manual_counts"]);
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

  it("names the previous period's applied count as the opening's source when it is the immediate predecessor", async () => {
    vi.mocked(changeLogRepository.findForRecord).mockResolvedValue([]);
    vi.mocked(manualCountRepository.findLatestBefore).mockResolvedValue({ entryDate: DATE, shift: "MORNING", manualCount: 100 } as never);

    expect((await getVarianceTrace(PRODUCT_ID, DATE, SHIFT, "ONLINE")).opening.source).toBe("count");
  });

  it("names the system carry as the opening's source when no count was applied", async () => {
    vi.mocked(changeLogRepository.findForRecord).mockResolvedValue([]);
    vi.mocked(manualCountRepository.findLatestBefore).mockResolvedValue(null);

    expect((await getVarianceTrace(PRODUCT_ID, DATE, SHIFT, "ONLINE")).opening.source).toBe("system");
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

describe("getVarianceReport - range limit", () => {
  it("refuses a range longer than a year, so one request cannot read every count", async () => {
    await expect(
      getVarianceReport({ startDate: new Date("2024-01-01T00:00:00Z"), endDate: new Date("2026-01-01T00:00:00Z") }),
    ).rejects.toMatchObject({ status: 400 });
  });
});

describe("publishing counts", () => {
  beforeEach(() => {
    snapshotTx.product.findMany.mockResolvedValue([
      { id: 10, sku: "A1", name: "APPLE", category: "Fruit" },
      { id: 11, sku: "B1", name: "BANANA", category: "Fruit" },
    ]);
    snapshotTx.auditSnapshot.create.mockResolvedValue({ id: 55 });
  });

  const pending = (id: number, productId: number, location: "ONLINE" | "OFFLINE") => ({ id, productId, location, manualCount: 5, publishedAt: null });

  it("an edited count goes back to unpublished, so only approved figures count as final", async () => {
    vi.mocked(dailyOnlineStockRepository.findByProductAndDate).mockResolvedValue({ remainingStock: 100 } as never);
    vi.mocked(manualCountRepository.findOne).mockResolvedValue({ id: 1, publishedAt: new Date() } as never);
    vi.mocked(manualCountRepository.upsert).mockImplementation(((_id: number | undefined, data: object) => Promise.resolve({ id: 1, ...data })) as never);

    await saveManualCount(PRODUCT_ID, DATE, SHIFT, "ONLINE", 90, 7);

    expect(vi.mocked(manualCountRepository.upsert).mock.calls[0][1]).toMatchObject({ publishedAt: null, publishedById: null });
  });

  it("publishes every waiting count on the sheet and logs each, without touching any opening stock", async () => {
    vi.mocked(manualCountRepository.findUnpublishedForPeriod).mockResolvedValue([pending(1, 10, "ONLINE"), pending(2, 11, "OFFLINE")] as never);
    vi.mocked(manualCountRepository.markPublished).mockImplementation(((id: number) => Promise.resolve({ id, publishedAt: new Date() })) as never);

    const out = await publishManualCounts(DATE, SHIFT, 7);

    expect(out.published).toBe(2);
    expect(manualCountRepository.markPublished).toHaveBeenCalledWith(1, 7, expect.any(Date), false, expect.anything());
    const calls = vi.mocked(recordChange).mock.calls.map((c) => c[0]);
    expect(calls).toHaveLength(2);
    expect(calls[0]).toMatchObject({ tableName: "manual_counts", recordId: 1, action: "UPDATE", changedById: 7 });
    expect(dailyOnlineStockRepository.findNext).not.toHaveBeenCalled();
    expect(dailyOfflineStockRepository.findNext).not.toHaveBeenCalled();
  });

  it("saves a frozen copy of what was released and files it in Audit History, whether or not it is applied to opening", async () => {
    vi.mocked(manualCountRepository.findUnpublishedForPeriod).mockResolvedValue([pending(1, 10, "ONLINE"), pending(2, 11, "OFFLINE")] as never);
    vi.mocked(manualCountRepository.markPublished).mockImplementation(((id: number) =>
      Promise.resolve({
        id,
        productId: id === 1 ? 10 : 11,
        location: id === 1 ? "ONLINE" : "OFFLINE",
        systemRemainingStock: 20,
        manualCount: 18,
        variance: 2,
        isOpeningBalance: false,
        remarks: "spoiled",
        publishedAt: new Date(),
      })) as never);

    const out = await publishManualCounts(DATE, SHIFT, 7, false);

    expect(out.snapshotId).toBe(55);
    const data = snapshotTx.auditSnapshot.create.mock.calls[0][0].data;
    expect(data).toMatchObject({ entryDate: DATE, shift: SHIFT, publishedById: 7, appliedToOpening: false });
    expect(data.payload.rows).toEqual([
      { location: "ONLINE", productId: 10, sku: "A1", name: "APPLE", category: "Fruit", systemRemainingStock: 20, manualCount: 18, variance: 2, isOpeningBalance: false, remarks: "spoiled" },
      { location: "OFFLINE", productId: 11, sku: "B1", name: "BANANA", category: "Fruit", systemRemainingStock: 20, manualCount: 18, variance: 2, isOpeningBalance: false, remarks: "spoiled" },
    ]);
    expect(recordReportHistoryIn).toHaveBeenCalledWith(
      snapshotTx,
      expect.objectContaining({ type: "Audit Report", scope: "2026-06-15", route: "/manual-count?history=1&snapshot=55&date=2026-06-15&shift=NIGHT&source=TOTAL", section: "all" }),
      7,
    );
  });

  describe("with applyToOpening", () => {
    const later = { id: 9, entryDate: new Date("2026-06-16T00:00:00.000Z"), shift: "MORNING", openingStock: 100, openingManual: false, stockInOffToOl: 0, stockOutOlToOff: 0, productionIn: 0, fulfillmentOut: 0, rts: 0 };

    beforeEach(() => {
      vi.mocked(manualCountRepository.markPublished).mockImplementation(((id: number) => Promise.resolve({ id, publishedAt: new Date() })) as never);
      vi.mocked(dailyOnlineStockRepository.productIdsWithRowsAfterDate).mockResolvedValue(new Set([10]));
      vi.mocked(dailyOfflineStockRepository.productIdsWithRowsAfterDate).mockResolvedValue(new Set());
      vi.mocked(dailyOnlineStockRepository.getOpeningStock).mockResolvedValue(95);
      vi.mocked(dailyOnlineStockRepository.upsert).mockResolvedValue({ ...later, openingStock: 95 } as never);
      vi.mocked(manualCountRepository.findOne).mockResolvedValue(null);
    });

    it("flags the counts and pushes them into the next saved period, naming the publish as cause", async () => {
      vi.mocked(manualCountRepository.findUnpublishedForPeriod).mockResolvedValue([pending(1, 10, "ONLINE"), pending(2, 11, "OFFLINE")] as never);
      vi.mocked(recordChange).mockResolvedValueOnce(101).mockResolvedValueOnce(102);
      vi.mocked(dailyOnlineStockRepository.findNext).mockResolvedValueOnce(later as never).mockResolvedValue(null);

      const out = await publishManualCounts(DATE, SHIFT, 7, true);

      expect(out).toMatchObject({ published: 2, appliedToOpening: true, keptManual: 0 });
      expect(manualCountRepository.markPublished).toHaveBeenCalledWith(1, 7, expect.any(Date), true, expect.anything());
      const calls = vi.mocked(recordChange).mock.calls.map((c) => c[0]);
      expect(calls.find((c) => c.tableName === "daily_online_stock")).toMatchObject({ recordId: 9, causedById: 101 });
    });

    it("never applies a TOTAL count, which cannot be split into an opening", async () => {
      vi.mocked(manualCountRepository.findUnpublishedForPeriod).mockResolvedValue([pending(1, 10, "TOTAL" as never)] as never);

      await publishManualCounts(DATE, SHIFT, 7, true);

      expect(manualCountRepository.markPublished).toHaveBeenCalledWith(1, 7, expect.any(Date), false, expect.anything());
      expect(dailyOnlineStockRepository.findNext).not.toHaveBeenCalled();
    });

    it("leaves an opening the encoder typed alone and reports how many it kept", async () => {
      vi.mocked(manualCountRepository.findUnpublishedForPeriod).mockResolvedValue([pending(1, 10, "ONLINE")] as never);
      vi.mocked(dailyOnlineStockRepository.findNext).mockResolvedValueOnce({ ...later, openingManual: true } as never).mockResolvedValue(null);

      const out = await publishManualCounts(DATE, SHIFT, 7, true);

      expect(out.keptManual).toBe(1);
      expect(dailyOnlineStockRepository.upsert).not.toHaveBeenCalled();
    });

    it("skips the walk for products with no later saved row", async () => {
      vi.mocked(manualCountRepository.findUnpublishedForPeriod).mockResolvedValue([pending(1, 12, "ONLINE")] as never);

      await publishManualCounts(DATE, SHIFT, 7, true);

      expect(dailyOnlineStockRepository.findNext).not.toHaveBeenCalled();
    });
  });

  it("saving an applied count again undoes it: the next period goes back to the carried figure", async () => {
    vi.mocked(dailyOnlineStockRepository.findByProductAndDate).mockResolvedValue({ remainingStock: 100 } as never);
    vi.mocked(manualCountRepository.findOne).mockResolvedValue({ id: 1, publishedAt: new Date(), appliedToOpening: true } as never);
    vi.mocked(manualCountRepository.upsert).mockImplementation(((_id: number | undefined, data: object) => Promise.resolve({ id: 1, ...data })) as never);
    vi.mocked(dailyOnlineStockRepository.findNext).mockResolvedValue(null);

    await saveManualCount(PRODUCT_ID, DATE, SHIFT, "ONLINE", 90, 7);

    expect(vi.mocked(manualCountRepository.upsert).mock.calls[0][1]).toMatchObject({ appliedToOpening: false, publishedAt: null });
    expect(dailyOnlineStockRepository.findNext).toHaveBeenCalled();
  });

  it("refuses when nothing is waiting", async () => {
    vi.mocked(manualCountRepository.findUnpublishedForPeriod).mockResolvedValue([]);
    await expect(publishManualCounts(DATE, SHIFT, 7)).rejects.toMatchObject({ status: 400 });
    expect(recordChange).not.toHaveBeenCalled();
  });
});


describe("opening balance - the first count of a product at a location", () => {
  beforeEach(() => {
    vi.mocked(dailyOnlineStockRepository.findByProductAndDate).mockResolvedValue({ remainingStock: 0 } as never);
    vi.mocked(manualCountRepository.upsert).mockImplementation(((_id: number | undefined, data: object) =>
      Promise.resolve({ id: 1, ...data })) as never);
  });

  it("records the first count with variance 0 even though the system says 0", async () => {
    vi.mocked(manualCountRepository.findOne).mockResolvedValue(null);
    vi.mocked(manualCountRepository.hasAnyCount).mockResolvedValue(false);

    await saveManualCount(PRODUCT_ID, DATE, SHIFT, "ONLINE", 120);

    expect(manualCountRepository.upsert).toHaveBeenCalledWith(
      undefined,
      expect.objectContaining({ isOpeningBalance: true, variance: 0, manualCount: 120, publishedAt: null }),
      expect.anything(),
    );
  });

  it("is saved unpublished, so a supervisor has to approve it", async () => {
    vi.mocked(manualCountRepository.findOne).mockResolvedValue(null);
    vi.mocked(manualCountRepository.hasAnyCount).mockResolvedValue(false);
    await saveManualCount(PRODUCT_ID, DATE, SHIFT, "ONLINE", 120);
    const data = vi.mocked(manualCountRepository.upsert).mock.calls[0][1];
    expect(data.publishedAt).toBeNull();
  });

  it("a later count is a normal audit count with a real variance", async () => {
    vi.mocked(manualCountRepository.findOne).mockResolvedValue(null);
    vi.mocked(dailyOnlineStockRepository.findByProductAndDate).mockResolvedValue({ remainingStock: 100 } as never);
    await saveManualCount(PRODUCT_ID, DATE, SHIFT, "ONLINE", 95);
    expect(manualCountRepository.upsert).toHaveBeenCalledWith(
      undefined,
      expect.objectContaining({ isOpeningBalance: false, variance: -5 }),
      expect.anything(),
    );
  });

  it("correcting the opening count later keeps it an opening balance", async () => {
    vi.mocked(manualCountRepository.findOne).mockResolvedValue({ id: 7, isOpeningBalance: true } as never);
    await saveManualCount(PRODUCT_ID, DATE, SHIFT, "ONLINE", 130);
    expect(manualCountRepository.upsert).toHaveBeenCalledWith(
      7,
      expect.objectContaining({ isOpeningBalance: true, variance: 0 }),
      expect.anything(),
    );
    expect(manualCountRepository.hasAnyCount).not.toHaveBeenCalled();
  });

  it("a TOTAL count is never an opening balance", async () => {
    vi.mocked(manualCountRepository.findOne).mockResolvedValue(null);
    vi.mocked(dailyOfflineStockRepository.findByProductAndDate).mockResolvedValue({ remainingStock: 10 } as never);
    await saveManualCount(PRODUCT_ID, DATE, SHIFT, "TOTAL", 4);
    expect(manualCountRepository.upsert).toHaveBeenCalledWith(undefined, expect.objectContaining({ isOpeningBalance: false }), expect.anything());
  });

  it("the grid labels an unsaved row for a never-counted product as an opening balance", async () => {
    vi.mocked(productRepository.findActive).mockResolvedValue([{ id: PRODUCT_ID, name: "Sweet A" }] as never);
    vi.mocked(manualCountRepository.findAllForDateAndLocation).mockResolvedValue([]);
    vi.mocked(dailyOnlineStockRepository.findAllForDate).mockResolvedValue([]);
    vi.mocked(manualCountRepository.productIdsWithCounts).mockResolvedValue(new Set());

    const rows = await getManualCountGrid(DATE, SHIFT, "ONLINE");
    expect(rows[0].entry).toMatchObject({ isOpeningBalance: true, variance: null });
  });

  it("the grid does not label it once the product has been counted", async () => {
    vi.mocked(productRepository.findActive).mockResolvedValue([{ id: PRODUCT_ID, name: "Sweet A" }] as never);
    vi.mocked(manualCountRepository.findAllForDateAndLocation).mockResolvedValue([]);
    vi.mocked(dailyOnlineStockRepository.findAllForDate).mockResolvedValue([]);
    const rows = await getManualCountGrid(DATE, SHIFT, "ONLINE");
    expect(rows[0].entry).toMatchObject({ isOpeningBalance: false });
  });
});

describe("getAuditSnapshot", () => {
  it("returns a published audit as it was released", async () => {
    snapshotTx.auditSnapshot.findUnique.mockResolvedValue({
      id: 5,
      entryDate: new Date("2026-06-15T00:00:00.000Z"),
      shift: "NIGHT",
      publishedAt: new Date("2026-06-16T01:00:00.000Z"),
      appliedToOpening: true,
      payload: { rows: [{ location: "ONLINE", productId: 10, name: "APPLE", manualCount: 18 }] },
    });
    expect(await getAuditSnapshot(5)).toEqual({
      id: 5,
      entryDate: "2026-06-15",
      shift: "NIGHT",
      publishedAt: "2026-06-16T01:00:00.000Z",
      appliedToOpening: true,
      revertedAt: null,
      rows: [{ location: "ONLINE", productId: 10, name: "APPLE", manualCount: 18 }],
    });
  });

  it("says so when the published audit no longer exists", async () => {
    snapshotTx.auditSnapshot.findUnique.mockResolvedValue(null);
    await expect(getAuditSnapshot(99)).rejects.toThrow(/no longer exists/);
  });
});

describe("reverting a published audit", () => {
  const PUBLISHED_AT = new Date("2026-06-16T01:00:00.000Z");
  const snapshot = { id: 7, entryDate: DATE, shift: SHIFT, publishedAt: PUBLISHED_AT, revertedAt: null };
  const count = { id: 31, productId: PRODUCT_ID, entryDate: DATE, shift: SHIFT, location: "ONLINE", publishedAt: PUBLISHED_AT, appliedToOpening: false };

  it("sends the counts that publish released back to unpublished, keeps the copy and marks it", async () => {
    snapshotTx.auditSnapshot.findUnique.mockResolvedValue(snapshot);
    snapshotTx.manualCount.findMany.mockResolvedValue([count, { ...count, id: 32, location: "OFFLINE" }]);
    snapshotTx.manualCount.update.mockImplementation(async ({ where }: { where: { id: number } }) => ({ ...count, id: where.id, publishedAt: null }));

    const result = await revertAuditSnapshot(7, "Counted the wrong shelf", 9);

    expect(result).toMatchObject({ snapshotId: 7, reverted: 2 });
    // Only the counts carrying THIS publish's timestamp are touched.
    expect(snapshotTx.manualCount.findMany.mock.calls[0][0].where).toMatchObject({ entryDate: DATE, shift: SHIFT, publishedAt: PUBLISHED_AT });
    expect(snapshotTx.manualCount.update.mock.calls[0][0].data).toEqual({ publishedAt: null, publishedById: null, appliedToOpening: false });
    expect(snapshotTx.auditSnapshot.update.mock.calls[0][0].data).toMatchObject({ revertedById: 9, revertReason: "Counted the wrong shelf" });
    expect(snapshotTx.auditSnapshot.update.mock.calls[0][0].data.revertedAt).toBeInstanceOf(Date);
    // Each count's change is logged.
    expect(vi.mocked(recordChange)).toHaveBeenCalledTimes(2);
  });

  it("refuses without a real reason, and refuses one already reverted", async () => {
    await expect(revertAuditSnapshot(7, "no", 9)).rejects.toThrow(/reason/);
    snapshotTx.auditSnapshot.findUnique.mockResolvedValue({ ...snapshot, revertedAt: new Date() });
    await expect(revertAuditSnapshot(7, "Counted the wrong shelf", 9)).rejects.toThrow(/already reverted/);
    expect(snapshotTx.manualCount.update).not.toHaveBeenCalled();
  });

  it("says so when the audit does not exist", async () => {
    snapshotTx.auditSnapshot.findUnique.mockResolvedValue(null);
    await expect(revertAuditSnapshot(99, "Counted the wrong shelf", 9)).rejects.toThrow(/no longer exists/);
  });

  it("an audit whose counts were edited since has nothing left to revert (canRevert is false)", async () => {
    snapshotTx.auditSnapshot.findMany.mockResolvedValue([snapshot, { ...snapshot, id: 8, shift: "MORNING" }]);
    // Only the Night sheet still carries this publish's timestamp.
    snapshotTx.manualCount.findMany.mockResolvedValue([{ entryDate: DATE, shift: "NIGHT", publishedAt: PUBLISHED_AT }]);
    const states = await getAuditSnapshotStates([7, 8]);
    expect(states.find((s) => s.id === 7)).toMatchObject({ reverted: false, canRevert: true });
    expect(states.find((s) => s.id === 8)).toMatchObject({ reverted: false, canRevert: false });
  });
});
