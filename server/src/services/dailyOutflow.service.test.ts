import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../lib/prisma", () => ({
  prisma: {
    dailyOnlineStock: { groupBy: vi.fn() },
    dailyOfflineStock: { groupBy: vi.fn() },
  },
}));

import { prisma } from "../lib/prisma";
import { getDailyOutflow } from "./dailyOutflow.service";

const d = (s: string) => new Date(`${s}T00:00:00Z`);

const online = (date: string, fulfillmentOut: number, rts = 0) => ({ entryDate: d(date), _sum: { fulfillmentOut, rts } });
const offline = (date: string, deliveryOut: number, backloads = 0) => ({
  entryDate: d(date),
  _sum: { deliveryOut, backloads },
});

beforeEach(() => {
  vi.mocked(prisma.dailyOnlineStock.groupBy).mockReset();
  vi.mocked(prisma.dailyOfflineStock.groupBy).mockReset();
});

function seed(on: ReturnType<typeof online>[], off: ReturnType<typeof offline>[]) {
  vi.mocked(prisma.dailyOnlineStock.groupBy).mockResolvedValue(on as never);
  vi.mocked(prisma.dailyOfflineStock.groupBy).mockResolvedValue(off as never);
}

describe("getDailyOutflow", () => {
  it("returns every date in the range, in order, including days nobody encoded", async () => {
    seed([online("2026-10-01", 100)], [offline("2026-10-03", 40)]);
    const rows = await getDailyOutflow(d("2026-10-01"), d("2026-10-03"));
    expect(rows.map((r) => r.date)).toEqual(["2026-10-01", "2026-10-02", "2026-10-03"]);
    expect(rows[1]).toEqual({ date: "2026-10-02", onlineOut: null, offlineOut: null, onlineRts: null, offlineBackloads: null, totalOut: null });
  });

  it("adds Online and Offline into the combined figure", async () => {
    seed([online("2026-10-01", 120)], [offline("2026-10-01", 80)]);
    const [row] = await getDailyOutflow(d("2026-10-01"), d("2026-10-01"));
    expect(row).toMatchObject({ onlineOut: 120, offlineOut: 80, totalOut: 200 });
  });

  it("nets the day's backloads off the Offline delivery, and shows the backloads beside it", async () => {
    // 100 delivered, 30 came back on a route the same day: 70 actually left.
    seed([], [offline("2026-10-01", 100, 30)]);
    const [row] = await getDailyOutflow(d("2026-10-01"), d("2026-10-01"));
    expect(row).toMatchObject({ offlineOut: 70, offlineBackloads: 30, totalOut: 70 });
  });

  it("does not count upsells in the Offline figure (the query does not even ask for them)", async () => {
    seed([], [offline("2026-10-01", 100, 0)]);
    await getDailyOutflow(d("2026-10-01"), d("2026-10-01"));
    expect(vi.mocked(prisma.dailyOfflineStock.groupBy).mock.calls[0][0]).toMatchObject({ _sum: { deliveryOut: true, backloads: true } });
    expect(vi.mocked(prisma.dailyOfflineStock.groupBy).mock.calls[0][0]).not.toMatchObject({ _sum: { upsellOut: true } });
  });

  it("shows a negative Offline figure when backloads exceed the delivery, so the totals still add up", async () => {
    seed([], [offline("2026-10-01", 20, 30)]);
    const [row] = await getDailyOutflow(d("2026-10-01"), d("2026-10-01"));
    expect(row).toMatchObject({ offlineOut: -10, offlineBackloads: 30, totalOut: -10 });
  });

  it("shows Online RTS beside the Online figure without netting it off", async () => {
    seed([online("2026-10-01", 50, 7)], [offline("2026-10-01", 40, 0)]);
    const [row] = await getDailyOutflow(d("2026-10-01"), d("2026-10-01"));
    expect(row).toMatchObject({ onlineOut: 50, onlineRts: 7, offlineOut: 40, totalOut: 90 });
  });

  it("reports a day with only one side recorded as that side, not as zero for the other", async () => {
    seed([online("2026-10-01", 50)], []);
    const [row] = await getDailyOutflow(d("2026-10-01"), d("2026-10-01"));
    expect(row).toEqual({ date: "2026-10-01", onlineOut: 50, onlineRts: 0, offlineOut: null, offlineBackloads: null, totalOut: 50 });
  });

  it("keeps a recorded zero as zero", async () => {
    seed([online("2026-10-01", 0)], [offline("2026-10-01", 0)]);
    const [row] = await getDailyOutflow(d("2026-10-01"), d("2026-10-01"));
    expect(row).toEqual({ date: "2026-10-01", onlineOut: 0, onlineRts: 0, offlineOut: 0, offlineBackloads: 0, totalOut: 0 });
  });

  it("sums once per query however many products there are", async () => {
    seed([], []);
    await getDailyOutflow(d("2026-10-01"), d("2026-10-31"));
    expect(prisma.dailyOnlineStock.groupBy).toHaveBeenCalledTimes(1);
    expect(prisma.dailyOfflineStock.groupBy).toHaveBeenCalledTimes(1);
    expect(vi.mocked(prisma.dailyOnlineStock.groupBy).mock.calls[0][0]).toMatchObject({ by: ["entryDate"] });
  });
});
