import { beforeEach, describe, expect, it, vi } from "vitest";

const prismaMock = vi.hoisted(() => {
  const mock = {
    dailyOnlineStock: { groupBy: vi.fn(), count: vi.fn() },
    dailyOfflineStock: { groupBy: vi.fn(), count: vi.fn() },
    dayClosure: { findMany: vi.fn() },
    manualCount: { count: vi.fn() },
    correctionRequest: { findMany: vi.fn() },
    pendingRelease: { count: vi.fn() },
    monthClosure: { findUnique: vi.fn(), create: vi.fn(), update: vi.fn(), findMany: vi.fn() },
    $transaction: vi.fn(),
  };
  mock.$transaction.mockImplementation((cb: (tx: unknown) => unknown) => cb(mock));
  return mock;
});
const serializableTransaction = vi.hoisted(() => vi.fn());
vi.mock("../lib/prisma", () => ({ prisma: prismaMock, serializableTransaction }));
vi.mock("./changeLog.service", () => ({ recordChange: vi.fn() }));
vi.mock("../lib/realtime", () => ({ broadcastRealtimeEvent: vi.fn() }));

import { closeMonth, monthBounds, monthReadiness, parseYearMonth, unlockMonth } from "./monthClose.service";

const D = (iso: string) => new Date(`${iso}T00:00:00.000Z`);
const period = (iso: string, shift: "MORNING" | "NIGHT") => ({ entryDate: D(iso), shift });
const AFTER_SEPTEMBER = new Date("2026-10-02T03:00:00.000Z");

/// A clean month: every worked period finished on both pages, nothing pending.
function cleanSeptember() {
  const worked = [period("2026-09-01", "NIGHT"), period("2026-09-02", "NIGHT")];
  prismaMock.dailyOnlineStock.groupBy.mockResolvedValue(worked);
  prismaMock.dailyOfflineStock.groupBy.mockResolvedValue(worked);
  prismaMock.dayClosure.findMany.mockResolvedValue(worked.map((p) => ({ ...p, onlineLocked: true, offlineLocked: true })));
  prismaMock.manualCount.count.mockResolvedValue(0);
  prismaMock.correctionRequest.findMany.mockResolvedValue([]);
  prismaMock.pendingRelease.count.mockResolvedValue(0);
}

beforeEach(() => {
  vi.clearAllMocks();
  serializableTransaction.mockImplementation((cb: (tx: unknown) => unknown) => cb(prismaMock));
  prismaMock.$transaction.mockImplementation((cb: (tx: unknown) => unknown) => cb(prismaMock));
  cleanSeptember();
});

describe("month helpers", () => {
  it("accepts only YYYY-MM", () => {
    expect(parseYearMonth("2026-09")).toBe("2026-09");
    for (const bad of ["2026-9", "2026-13", "2026-00", "2026-09-01", "", undefined, 202609]) {
      expect(() => parseYearMonth(bad)).toThrow();
    }
  });

  it("finds the first and last day, leap years included", () => {
    expect(monthBounds("2026-09")).toEqual({ from: D("2026-09-01"), to: D("2026-09-30") });
    expect(monthBounds("2028-02").to).toEqual(D("2028-02-29"));
    expect(monthBounds("2026-12").to).toEqual(D("2026-12-31"));
  });
});

describe("monthReadiness", () => {
  it("is ready when the month has ended and everything is finished, published and settled", async () => {
    const r = await monthReadiness("2026-09", AFTER_SEPTEMBER);
    expect(r).toMatchObject({ ready: true, problems: [], periodsWithEntries: 2 });
  });

  it("is not ready until the month has actually ended", async () => {
    const r = await monthReadiness("2026-09", new Date("2026-09-30T20:00:00.000Z"));
    expect(r.ready).toBe(false);
    expect(r.problems[0]).toContain("has not ended yet");
  });

  it("blocks on a page that is not finished, naming the first one", async () => {
    prismaMock.dayClosure.findMany.mockResolvedValue([
      { ...period("2026-09-01", "NIGHT"), onlineLocked: true, offlineLocked: true },
      { ...period("2026-09-02", "NIGHT"), onlineLocked: true, offlineLocked: false },
    ]);
    const r = await monthReadiness("2026-09", AFTER_SEPTEMBER);
    expect(r.ready).toBe(false);
    expect(r.problems.join(" ")).toContain("1 page(s) are not finished - first: 2026-09-02 (Night, Offline)");
  });

  it("blocks on unpublished counts", async () => {
    prismaMock.manualCount.count.mockResolvedValueOnce(3);
    const r = await monthReadiness("2026-09", AFTER_SEPTEMBER);
    expect(r.problems).toContain("3 count(s) in 2026-09 are still unpublished.");
  });

  it("blocks on a pending correction whose record is in the month, and ignores one in another month", async () => {
    prismaMock.correctionRequest.findMany.mockResolvedValue([
      { tableName: "daily_online_stock", recordId: 11 },
      { tableName: "daily_online_stock", recordId: 12 },
    ]);
    prismaMock.dailyOnlineStock.count.mockResolvedValue(1); // only id 11 falls inside September
    const r = await monthReadiness("2026-09", AFTER_SEPTEMBER);
    expect(r.problems).toContain("1 correction request(s) against 2026-09 are still pending.");
  });

  it("blocks an empty month", async () => {
    prismaMock.dailyOnlineStock.groupBy.mockResolvedValue([]);
    prismaMock.dailyOfflineStock.groupBy.mockResolvedValue([]);
    prismaMock.dayClosure.findMany.mockResolvedValue([]);
    const r = await monthReadiness("2026-09", AFTER_SEPTEMBER);
    expect(r.problems.join(" ")).toContain("nothing to close");
  });

  it("warns, without blocking, about empty days and unreleased items", async () => {
    const worked = [period("2026-09-01", "NIGHT"), period("2026-09-05", "NIGHT")];
    prismaMock.dailyOnlineStock.groupBy.mockResolvedValue(worked);
    prismaMock.dailyOfflineStock.groupBy.mockResolvedValue([]);
    prismaMock.dayClosure.findMany.mockResolvedValue(worked.map((p) => ({ ...p, onlineLocked: true, offlineLocked: true })));
    prismaMock.pendingRelease.count.mockResolvedValue(2);
    const r = await monthReadiness("2026-09", AFTER_SEPTEMBER);
    expect(r.ready).toBe(true);
    expect(r.warnings[0]).toContain("3 day(s): 2026-09-02, 2026-09-03, 2026-09-04");
    expect(r.warnings[1]).toContain("2 awaiting-release item(s)");
  });
});

describe("closeMonth / unlockMonth", () => {
  it("refuses to close a month that is not ready, and says why", async () => {
    prismaMock.manualCount.count.mockResolvedValueOnce(1);
    await expect(closeMonth("2026-09", 1)).rejects.toMatchObject({ status: 400 });
    expect(prismaMock.monthClosure.create).not.toHaveBeenCalled();
  });

  it("refuses to close a month that is already closed", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(AFTER_SEPTEMBER);
    try {
      prismaMock.monthClosure.findUnique.mockResolvedValue({ id: 1, yearMonth: "2026-09", isClosed: true });
      await expect(closeMonth("2026-09", 1)).rejects.toMatchObject({ status: 409 });
    } finally {
      vi.useRealTimers();
    }
  });

  it("checks readiness and writes the lock inside one serializable transaction", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(AFTER_SEPTEMBER);
    try {
      prismaMock.monthClosure.findUnique.mockResolvedValue(null);
      prismaMock.monthClosure.create.mockResolvedValue({ id: 7, yearMonth: "2026-09", isClosed: true });
      await closeMonth("2026-09", 1);
      expect(serializableTransaction).toHaveBeenCalledTimes(1);
      // The readiness reads went through the transaction's client, not around it.
      expect(prismaMock.dailyOnlineStock.groupBy).toHaveBeenCalled();
      expect(prismaMock.monthClosure.create).toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it("closes a ready month", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(AFTER_SEPTEMBER);
    try {
      prismaMock.monthClosure.findUnique.mockResolvedValue(null);
      prismaMock.monthClosure.create.mockResolvedValue({ id: 7, yearMonth: "2026-09", isClosed: true });
      const result = await closeMonth("2026-09", 1);
      expect(result).toMatchObject({ id: 7, isClosed: true });
      expect(prismaMock.monthClosure.create).toHaveBeenCalledWith({ data: expect.objectContaining({ yearMonth: "2026-09", isClosed: true, closedById: 1 }) });
    } finally {
      vi.useRealTimers();
    }
  });

  it("unlocks only a closed month, and keeps the reason", async () => {
    prismaMock.monthClosure.findUnique.mockResolvedValueOnce(null);
    await expect(unlockMonth("2026-09", "Late invoice found", 1)).rejects.toMatchObject({ status: 409 });

    prismaMock.monthClosure.findUnique.mockResolvedValueOnce({ id: 7, yearMonth: "2026-09", isClosed: true });
    prismaMock.monthClosure.update.mockResolvedValue({ id: 7, isClosed: false });
    await unlockMonth("2026-09", "Late invoice found", 1);
    expect(prismaMock.monthClosure.update).toHaveBeenCalledWith({
      where: { id: 7 },
      data: expect.objectContaining({ isClosed: false, unlockReason: "Late invoice found", unlockedById: 1 }),
    });
  });
});
