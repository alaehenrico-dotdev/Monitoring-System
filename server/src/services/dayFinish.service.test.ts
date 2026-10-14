import { beforeEach, describe, expect, it, vi } from "vitest";

const prismaMock = vi.hoisted(() => {
  const m = {
    dailyOnlineStock: { count: vi.fn() },
    dailyOfflineStock: { count: vi.fn() },
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
vi.mock("./dayLock.service", () => ({ closePeriod, assertEarlierDaysFinished }));
const buildDailyReport = vi.hoisted(() => vi.fn());
vi.mock("./reports.service", () => ({ buildDailyReport }));
const saveSnapshot = vi.hoisted(() => vi.fn());
vi.mock("./dailyReportSnapshot.service", () => ({ saveSnapshot }));
const recordReportHistoryIn = vi.hoisted(() => vi.fn());
vi.mock("./reportHistory.service", () => ({ recordReportHistoryIn }));

import { finishDay } from "./dayFinish.service";

const DATE = new Date("2026-10-14T00:00:00.000Z");

function summary(online: number, offline: number, closed = false) {
  prismaMock.dailyOnlineStock.count.mockResolvedValue(online);
  prismaMock.dailyOfflineStock.count.mockResolvedValue(offline);
  prismaMock.product.count.mockResolvedValue(60);
  prismaMock.dayClosure.findUnique.mockResolvedValue(closed ? { isClosed: true } : null);
}

beforeEach(() => vi.clearAllMocks());

describe("finishDay", () => {
  it("refuses a shift with nothing saved", async () => {
    summary(0, 0);
    await expect(finishDay(DATE, "NIGHT", 1)).rejects.toMatchObject({ status: 400 });
    expect(closePeriod).not.toHaveBeenCalled();
  });

  it("locks entries only and saves the snapshot in one transaction", async () => {
    summary(58, 60);
    buildDailyReport.mockResolvedValue({ date: "2026-10-14" });
    const result = await finishDay(DATE, "NIGHT", 7);
    expect(closePeriod).toHaveBeenCalledWith(DATE, "NIGHT", { entriesOnly: true, userId: 7 }, prismaMock);
    expect(saveSnapshot).toHaveBeenCalledWith(DATE, { date: "2026-10-14" }, 7, prismaMock);
    expect(result.finished).toBe(true);
  });

  it("lists the saved report in Daily Report History, in the same transaction", async () => {
    summary(58, 60);
    buildDailyReport.mockResolvedValue({ date: "2026-10-14" });
    await finishDay(DATE, "NIGHT", 7);
    expect(recordReportHistoryIn).toHaveBeenCalledWith(
      prismaMock,
      { type: "Daily Report", scope: "2026-10-14", route: "/daily-report?history=1&date=2026-10-14", section: "all" },
      7,
    );
  });

  it("refuses to finish a day while an earlier day is unfinished", async () => {
    summary(58, 60);
    assertEarlierDaysFinished.mockRejectedValueOnce(Object.assign(new Error("Finish 2026-10-13 first"), { status: 409 }));
    await expect(finishDay(DATE, "NIGHT", 1)).rejects.toMatchObject({ status: 409 });
    expect(closePeriod).not.toHaveBeenCalled();
  });

  it("is a no-op when the shift is already finished", async () => {
    summary(58, 60, true);
    const result = await finishDay(DATE, "NIGHT", 7);
    expect(result.finished).toBe(false);
    expect(closePeriod).not.toHaveBeenCalled();
    expect(saveSnapshot).not.toHaveBeenCalled();
    expect(recordReportHistoryIn).not.toHaveBeenCalled();
  });
});
