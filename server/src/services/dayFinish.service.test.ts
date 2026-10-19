import { beforeEach, describe, expect, it, vi } from "vitest";

const prismaMock = vi.hoisted(() => {
  const m = {
    dailyOnlineStock: { count: vi.fn(), findMany: vi.fn() },
    dailyOfflineStock: { count: vi.fn(), findMany: vi.fn() },
    product: { count: vi.fn() },
    dayClosure: { findUnique: vi.fn() },
    $transaction: vi.fn(),
  };
  m.$transaction.mockImplementation(async (fn: (tx: unknown) => unknown) => fn(m));
  return m;
});
vi.mock("../lib/prisma", () => ({ prisma: prismaMock }));
vi.mock("../lib/realtime", () => ({ broadcastRealtimeEvent: vi.fn() }));

const closePeriod = vi.hoisted(() => vi.fn());
const assertEarlierDaysFinished = vi.hoisted(() => vi.fn());
vi.mock("./dayLock.service", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./dayLock.service")>()),
  closePeriod,
  assertEarlierDaysFinished,
}));
const buildDailyReport = vi.hoisted(() => vi.fn());
vi.mock("./reports.service", () => ({ buildDailyReport }));
const saveSnapshot = vi.hoisted(() => vi.fn());
vi.mock("./dailyReportSnapshot.service", () => ({ saveSnapshot }));
const recordReportHistoryIn = vi.hoisted(() => vi.fn());
vi.mock("./reportHistory.service", () => ({ recordReportHistoryIn }));
const logSystemEvent = vi.hoisted(() => vi.fn());
vi.mock("./changeLog.service", () => ({ logSystemEvent }));

import { finishDay, getFinishSummary } from "./dayFinish.service";

const DATE = new Date("2026-10-14T00:00:00.000Z");

function summary(online: number, offline: number, locked: { online?: boolean; offline?: boolean } = {}) {
  prismaMock.dailyOnlineStock.count.mockResolvedValue(online);
  prismaMock.dailyOfflineStock.count.mockResolvedValue(offline);
  prismaMock.product.count.mockResolvedValue(60);
  const onlineLocked = locked.online ?? false;
  const offlineLocked = locked.offline ?? false;
  prismaMock.dayClosure.findUnique.mockResolvedValue(
    onlineLocked || offlineLocked ? { isClosed: onlineLocked && offlineLocked, onlineLocked, offlineLocked } : null,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  prismaMock.dailyOnlineStock.findMany.mockResolvedValue([]);
  prismaMock.dailyOfflineStock.findMany.mockResolvedValue([]);
});

const negativeRow = { productId: 3, remainingStock: "-5.00", product: { name: "APPLE" } };

describe("finishDay", () => {
  it("refuses a shift with nothing saved", async () => {
    summary(0, 0);
    await expect(finishDay(DATE, "NIGHT", "ONLINE", 1)).rejects.toMatchObject({ status: 400 });
    expect(closePeriod).not.toHaveBeenCalled();
  });

  it("locks entries only and saves the snapshot in one transaction when the other page is already finished", async () => {
    summary(58, 60, { offline: true });
    buildDailyReport.mockResolvedValue({ date: "2026-10-14" });
    const result = await finishDay(DATE, "NIGHT", "ONLINE", 7);
    expect(closePeriod).toHaveBeenCalledWith(DATE, "NIGHT", { entriesOnly: true, userId: 7, location: "ONLINE" }, prismaMock);
    expect(saveSnapshot).toHaveBeenCalledWith(DATE, { date: "2026-10-14" }, 7, prismaMock);
    expect(result.finished).toBe(true);
  });

  it("lists the saved report in Daily Report History, in the same transaction", async () => {
    summary(58, 60, { offline: true });
    buildDailyReport.mockResolvedValue({ date: "2026-10-14" });
    await finishDay(DATE, "NIGHT", "ONLINE", 7);
    expect(recordReportHistoryIn).toHaveBeenCalledWith(
      prismaMock,
      { type: "Daily Report", scope: "2026-10-14", route: "/daily-report?history=1&date=2026-10-14", section: "all" },
      7,
    );
  });

  it("locks only its own page and leaves the report live while the other page is still being entered", async () => {
    summary(58, 60);
    const result = await finishDay(DATE, "NIGHT", "ONLINE", 7);
    expect(closePeriod).toHaveBeenCalledWith(DATE, "NIGHT", { entriesOnly: true, userId: 7, location: "ONLINE" }, prismaMock);
    expect(assertEarlierDaysFinished).toHaveBeenCalledWith(DATE, expect.anything(), "ONLINE");
    expect(saveSnapshot).not.toHaveBeenCalled();
    expect(result).toMatchObject({ finished: true, reportSaved: false });
  });

  it("saves the snapshot when the other page has nothing saved at all", async () => {
    summary(58, 0);
    await finishDay(DATE, "NIGHT", "ONLINE", 7);
    expect(saveSnapshot).toHaveBeenCalled();
  });

  it("refuses to finish a page that has nothing saved, even if the other has", async () => {
    summary(0, 60);
    await expect(finishDay(DATE, "NIGHT", "ONLINE", 7)).rejects.toMatchObject({ status: 400 });
  });

  it("treats a page finished by someone else as already done, without touching the other", async () => {
    summary(58, 60, { online: true });
    expect((await finishDay(DATE, "NIGHT", "ONLINE", 7)).finished).toBe(false);
    expect((await finishDay(DATE, "NIGHT", "OFFLINE", 7)).finished).toBe(true);
  });

  it("refuses to finish a day while an earlier day is unfinished", async () => {
    summary(58, 60);
    assertEarlierDaysFinished.mockRejectedValueOnce(Object.assign(new Error("Finish 2026-10-13 first"), { status: 409 }));
    await expect(finishDay(DATE, "NIGHT", "ONLINE", 1)).rejects.toMatchObject({ status: 409 });
    expect(closePeriod).not.toHaveBeenCalled();
  });

  it("is a no-op when the shift is already finished", async () => {
    summary(58, 60, { online: true, offline: true });
    const result = await finishDay(DATE, "NIGHT", "ONLINE", 7);
    expect(result.finished).toBe(false);
    expect(closePeriod).not.toHaveBeenCalled();
    expect(saveSnapshot).not.toHaveBeenCalled();
    expect(recordReportHistoryIn).not.toHaveBeenCalled();
  });

  describe("negative stock", () => {
    beforeEach(() => {
      summary(58, 60);
      prismaMock.dailyOnlineStock.findMany.mockResolvedValue([negativeRow]);
    });

    it("lists the negative products in the finish summary", async () => {
      const s = await getFinishSummary(DATE, "NIGHT", "ONLINE");
      expect(s.negatives).toEqual([{ productId: 3, name: "APPLE", remainingStock: -5 }]);
    });

    it("stops an encoder finishing over negative stock", async () => {
      await expect(finishDay(DATE, "NIGHT", "ONLINE", 1)).rejects.toMatchObject({ status: 409 });
      expect(closePeriod).not.toHaveBeenCalled();
    });

    it("needs a reason from a supervisor", async () => {
      await expect(finishDay(DATE, "NIGHT", "ONLINE", 1, { allowed: true })).rejects.toMatchObject({ status: 400 });
      await expect(finishDay(DATE, "NIGHT", "ONLINE", 1, { allowed: true, reason: " x " })).rejects.toMatchObject({ status: 400 });
      expect(closePeriod).not.toHaveBeenCalled();
    });

    it("lets a supervisor finish with a reason, and records the sign-off", async () => {
      const result = await finishDay(DATE, "NIGHT", "ONLINE", 9, { allowed: true, reason: "Production In arrives tomorrow" });
      expect(result.finished).toBe(true);
      expect(closePeriod).toHaveBeenCalled();
      expect(logSystemEvent).toHaveBeenCalledWith(
        "negative_stock_signoff",
        expect.objectContaining({ shift: "NIGHT", location: "ONLINE", reason: "Production In arrives tomorrow" }),
        9,
      );
    });
  });
});
