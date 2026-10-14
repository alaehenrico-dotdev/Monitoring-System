import { beforeEach, describe, expect, it, vi } from "vitest";

const prismaMock = vi.hoisted(() => ({
  dayClosure: { findUnique: vi.fn(), findFirst: vi.fn(), findMany: vi.fn() },
  dailyOnlineStock: { groupBy: vi.fn() },
  dailyOfflineStock: { groupBy: vi.fn() },
}));
vi.mock("../lib/prisma", () => ({ prisma: prismaMock }));
vi.mock("./changeLog.service", () => ({ recordChange: vi.fn() }));
vi.mock("../lib/realtime", () => ({ broadcastRealtimeEvent: vi.fn() }));

import { assertEarlierDaysFinished, assertPeriodOpen, findUnfinishedEarlierPeriod, runAsAdjustment } from "./dayLock.service";

const DATE = new Date("2026-10-12T00:00:00.000Z");

beforeEach(() => vi.clearAllMocks());

describe("assertPeriodOpen", () => {
  it("allows a day with no closure row", async () => {
    prismaMock.dayClosure.findUnique.mockResolvedValue(null);
    await expect(assertPeriodOpen(DATE, "MORNING")).resolves.toBeUndefined();
  });

  it("allows a day that was closed and then unlocked", async () => {
    prismaMock.dayClosure.findUnique.mockResolvedValue({ isClosed: false });
    await expect(assertPeriodOpen(DATE, "NIGHT")).resolves.toBeUndefined();
  });

  it("refuses a closed day with a 409 that names the way out", async () => {
    prismaMock.dayClosure.findUnique.mockResolvedValue({ isClosed: true });
    await expect(assertPeriodOpen(DATE, "NIGHT")).rejects.toMatchObject({
      status: 409,
      message: expect.stringContaining("2026-10-12"),
    });
  });

  it("lets Manual Counts through an entries-only (Finish day) lock, but not entries", async () => {
    prismaMock.dayClosure.findUnique.mockResolvedValue({ isClosed: true, entriesOnly: true });
    await expect(assertPeriodOpen(DATE, "NIGHT", undefined, "count")).resolves.toBeUndefined();
    await expect(assertPeriodOpen(DATE, "NIGHT")).rejects.toMatchObject({ status: 409 });
  });

  it("refuses Manual Counts on a full close", async () => {
    prismaMock.dayClosure.findUnique.mockResolvedValue({ isClosed: true, entriesOnly: false });
    await expect(assertPeriodOpen(DATE, "NIGHT", undefined, "count")).rejects.toMatchObject({ status: 409 });
  });

  it("lets an approved adjustment through a closed day", async () => {
    prismaMock.dayClosure.findUnique.mockResolvedValue({ isClosed: true });
    await expect(runAsAdjustment(() => assertPeriodOpen(DATE, "NIGHT"))).resolves.toBeUndefined();
  });
});

describe("days are finished in order", () => {
  const D = (iso: string) => new Date(`${iso}T00:00:00.000Z`);
  const period = (iso: string, shift: "MORNING" | "NIGHT") => ({ entryDate: D(iso), shift });

  function setup(opts: { first?: string | null; online?: ReturnType<typeof period>[]; offline?: ReturnType<typeof period>[]; closed?: ReturnType<typeof period>[] }) {
    prismaMock.dayClosure.findFirst.mockResolvedValue(opts.first ? { entryDate: D(opts.first) } : null);
    prismaMock.dailyOnlineStock.groupBy.mockResolvedValue(opts.online ?? []);
    prismaMock.dailyOfflineStock.groupBy.mockResolvedValue(opts.offline ?? []);
    prismaMock.dayClosure.findMany.mockResolvedValue(opts.closed ?? []);
  }

  it("does not apply before any day was ever finished (existing history never was)", async () => {
    setup({ first: null, online: [period("2026-10-01", "NIGHT")] });
    expect(await findUnfinishedEarlierPeriod(D("2026-10-14"))).toBeNull();
  });

  it("does not look at days before the first finished one", async () => {
    setup({ first: "2026-10-14" });
    expect(await findUnfinishedEarlierPeriod(D("2026-10-14"))).toBeNull();
    expect(prismaMock.dailyOnlineStock.groupBy).not.toHaveBeenCalled();
  });

  it("names the earliest earlier day that has entries but is not finished", async () => {
    setup({
      first: "2026-10-08",
      online: [period("2026-10-09", "NIGHT"), period("2026-10-10", "MORNING")],
      offline: [period("2026-10-09", "NIGHT")],
      closed: [period("2026-10-08", "NIGHT")],
    });
    expect(await findUnfinishedEarlierPeriod(D("2026-10-12"))).toEqual({ entryDate: "2026-10-09", shift: "NIGHT" });
  });

  it("is clear when every earlier day with entries is finished (a day with no entries never blocks)", async () => {
    setup({
      first: "2026-10-08",
      online: [period("2026-10-09", "NIGHT")],
      closed: [period("2026-10-09", "NIGHT")],
    });
    expect(await findUnfinishedEarlierPeriod(D("2026-10-12"))).toBeNull();
  });

  it("orders Morning before Night within a day when naming the blocker", async () => {
    setup({ first: "2026-10-08", online: [period("2026-10-09", "NIGHT"), period("2026-10-09", "MORNING")] });
    expect(await findUnfinishedEarlierPeriod(D("2026-10-12"))).toEqual({ entryDate: "2026-10-09", shift: "MORNING" });
  });

  it("refuses an entry write with a 409 that says which day to finish", async () => {
    setup({ first: "2026-10-08", online: [period("2026-10-09", "NIGHT")] });
    await expect(assertEarlierDaysFinished(D("2026-10-12"))).rejects.toMatchObject({
      status: 409,
      message: expect.stringContaining("2026-10-09"),
    });
  });

  it("is skipped inside an approved correction", async () => {
    setup({ first: "2026-10-08", online: [period("2026-10-09", "NIGHT")] });
    await expect(runAsAdjustment(() => assertEarlierDaysFinished(D("2026-10-12")))).resolves.toBeUndefined();
  });
});
