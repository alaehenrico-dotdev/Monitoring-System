import { beforeEach, describe, expect, it, vi } from "vitest";

const prismaMock = vi.hoisted(() => {
  const m = {
    correctionRequest: { findUnique: vi.fn(), update: vi.fn() },
    dailyOnlineStock: { findUnique: vi.fn() },
    dailyOfflineStock: { findUnique: vi.fn() },
    manualCount: { findUnique: vi.fn() },
    $transaction: vi.fn(),
  };
  m.$transaction.mockImplementation(async (fn: (tx: unknown) => unknown) => fn(m));
  return m;
});
vi.mock("../lib/prisma", () => ({ prisma: prismaMock }));
vi.mock("../lib/realtime", () => ({ broadcastRealtimeEvent: vi.fn() }));
vi.mock("./changeLog.service", () => ({ recordChange: vi.fn() }));

const saveOnlineEntry = vi.hoisted(() => vi.fn());
const saveOfflineEntry = vi.hoisted(() => vi.fn());
const saveManualCount = vi.hoisted(() => vi.fn());
const propagateOpeningStock = vi.hoisted(() => vi.fn());
vi.mock("./dailyOnlineStock.service", () => ({ saveOnlineEntry }));
vi.mock("./dailyOfflineStock.service", () => ({ saveOfflineEntry }));
vi.mock("./manualCounts.service", () => ({ saveManualCount, propagateOpeningStock }));
const refreshFrozenSnapshots = vi.hoisted(() => vi.fn());
vi.mock("./snapshotRefresh.service", () => ({ refreshFrozenSnapshots }));

// Real adjustment context: what the saves see is the thing under test.
const seenByAdjustment = vi.hoisted(() => ({ cascade: undefined as undefined | boolean }));
vi.mock("./dayLock.service", async (importOriginal) => {
  const real = await importOriginal<typeof import("./dayLock.service")>();
  return {
    ...real,
    runAsAdjustment: <T>(fn: () => Promise<T>, opts?: { cascade?: boolean }) => {
      seenByAdjustment.cascade = opts?.cascade;
      return real.runAsAdjustment(fn, opts);
    },
  };
});

import { approveCorrection } from "./correction.service";

const D = (iso: string) => new Date(`${iso}T00:00:00.000Z`);
const request = (over: Record<string, unknown> = {}) => ({
  id: 1,
  tableName: "daily_online_stock",
  recordId: 50,
  field: "fulfillmentOut",
  beforeValue: "10",
  proposedValue: "4",
  status: "PENDING",
  ...over,
});

beforeEach(() => {
  vi.clearAllMocks();
  seenByAdjustment.cascade = undefined;
  prismaMock.$transaction.mockImplementation(async (fn: (tx: unknown) => unknown) => fn(prismaMock));
  prismaMock.dailyOnlineStock.findUnique.mockResolvedValue({ id: 50, productId: 11, entryDate: D("2026-10-10"), shift: "NIGHT", fulfillmentOut: "10", openingStock: "80" });
  prismaMock.dailyOfflineStock.findUnique.mockResolvedValue({ id: 60, productId: 11, entryDate: D("2026-10-10"), shift: "NIGHT", openingStock: "80" });
  prismaMock.correctionRequest.update.mockImplementation(async ({ data }: { data: object }) => ({ id: 1, ...data }));
  refreshFrozenSnapshots.mockResolvedValue([D("2026-10-10")]);
});

describe("approveCorrection", () => {
  it("applies the figure through the normal save, not cascading by default", async () => {
    prismaMock.correctionRequest.findUnique.mockResolvedValue(request());
    await approveCorrection(1, "ok", 3);
    expect(saveOnlineEntry).toHaveBeenCalledWith(11, D("2026-10-10"), "NIGHT", { fulfillmentOut: 4 }, 3);
    expect(seenByAdjustment.cascade).toBeUndefined();
  });

  it("passes an explicit cascade choice down to the adjustment context", async () => {
    prismaMock.correctionRequest.findUnique.mockResolvedValue(request());
    await approveCorrection(1, undefined, 3, { cascade: true });
    expect(seenByAdjustment.cascade).toBe(true);
    expect(refreshFrozenSnapshots).toHaveBeenCalledWith(D("2026-10-10"), { cascade: true, userId: 3 });
  });

  it("re-saves the frozen report of the corrected day and reports which dates it refreshed", async () => {
    prismaMock.correctionRequest.findUnique.mockResolvedValue(request());
    const result = await approveCorrection(1, undefined, 3);
    expect(refreshFrozenSnapshots).toHaveBeenCalledWith(D("2026-10-10"), { cascade: undefined, userId: 3 });
    expect(result).toMatchObject({ status: "APPROVED", appliedBefore: "10", snapshotsRefreshed: ["2026-10-10"] });
  });

  it("a stale-opening request re-derives the row through the carry-forward walk and never types an opening", async () => {
    prismaMock.correctionRequest.findUnique.mockResolvedValue(request({ field: "openingStock", beforeValue: "80", proposedValue: "180" }));
    await approveCorrection(1, undefined, 3);

    expect(saveOnlineEntry).not.toHaveBeenCalled(); // would pin the opening as manual
    expect(propagateOpeningStock).toHaveBeenCalledTimes(1);
    const args = propagateOpeningStock.mock.calls[0];
    expect(args.slice(0, 5)).toEqual([11, D("2026-10-10"), "NIGHT", "ONLINE", 3]);
    expect(args[7]).toEqual({ from: { entryDate: D("2026-10-10"), shift: "MORNING" }, approvedRowId: 50 });
  });

  it("a stale Offline opening walks the Offline chain, starting just before a Morning row on the previous Night", async () => {
    prismaMock.dailyOfflineStock.findUnique.mockResolvedValue({ id: 60, productId: 11, entryDate: D("2026-10-10"), shift: "MORNING", openingStock: "80" });
    prismaMock.correctionRequest.findUnique.mockResolvedValue(request({ tableName: "daily_offline_stock", recordId: 60, field: "openingStock" }));
    await approveCorrection(1, undefined, 3);
    const args = propagateOpeningStock.mock.calls[0];
    expect(args[3]).toBe("OFFLINE");
    expect(args[7]).toEqual({ from: { entryDate: D("2026-10-09"), shift: "NIGHT" }, approvedRowId: 60 });
  });

  it("refuses a request that was already decided, and changes nothing", async () => {
    prismaMock.correctionRequest.findUnique.mockResolvedValue(request({ status: "APPROVED" }));
    await expect(approveCorrection(1, undefined, 3)).rejects.toMatchObject({ status: 409 });
    expect(saveOnlineEntry).not.toHaveBeenCalled();
    expect(refreshFrozenSnapshots).not.toHaveBeenCalled();
  });
});
