import { beforeEach, describe, expect, it, vi } from "vitest";

const prismaMock = vi.hoisted(() => ({
  dayClosure: { findUnique: vi.fn(), findFirst: vi.fn(), findMany: vi.fn() },
  monthClosure: { findUnique: vi.fn() },
  dailyOnlineStock: { groupBy: vi.fn() },
  dailyOfflineStock: { groupBy: vi.fn() },
}));
vi.mock("../lib/prisma", () => ({ prisma: prismaMock }));
vi.mock("./changeLog.service", () => ({ recordChange: vi.fn() }));
vi.mock("../lib/realtime", () => ({ broadcastRealtimeEvent: vi.fn() }));
const rules = vi.hoisted(() => ({ requireEarlierDaysFinished: true }));
vi.mock("./appSettings.service", () => ({ getEntryRules: vi.fn(async () => ({ ...rules })) }));

import { assertEarlierDaysFinished, findUnfinishedEarlierPeriod, getClosureStatus, runAsAdjustment } from "./dayLock.service";

const D = (iso: string) => new Date(`${iso}T00:00:00.000Z`);
const TODAY = D("2026-10-14");

/// Oct 9 has entries and was never finished; Oct 8 is the first day ever finished.
function earlierDayOpen() {
  prismaMock.dayClosure.findFirst.mockResolvedValue({ entryDate: D("2026-10-08") });
  prismaMock.dailyOnlineStock.groupBy.mockResolvedValue([{ entryDate: D("2026-10-09"), shift: "NIGHT" }]);
  prismaMock.dailyOfflineStock.groupBy.mockResolvedValue([]);
  prismaMock.dayClosure.findMany.mockResolvedValue([]);
  prismaMock.dayClosure.findUnique.mockResolvedValue(null);
}

beforeEach(() => {
  vi.clearAllMocks();
  rules.requireEarlierDaysFinished = true;
  earlierDayOpen();
});

describe("entering while an earlier day is unfinished", () => {
  it("is blocked by default - days are finished in order", async () => {
    expect(await findUnfinishedEarlierPeriod(TODAY)).toEqual({ entryDate: "2026-10-09", shift: "NIGHT" });
    await expect(assertEarlierDaysFinished(TODAY)).rejects.toMatchObject({ status: 409, message: expect.stringContaining("2026-10-09") });
  });

  it("is allowed once an admin turns the rule off", async () => {
    rules.requireEarlierDaysFinished = false;
    expect(await findUnfinishedEarlierPeriod(TODAY)).toBeNull();
    await expect(assertEarlierDaysFinished(TODAY, undefined, "ONLINE")).resolves.toBeUndefined();
  });

  it("does not even scan the earlier days when the rule is off", async () => {
    rules.requireEarlierDaysFinished = false;
    await findUnfinishedEarlierPeriod(TODAY);
    expect(prismaMock.dailyOnlineStock.groupBy).not.toHaveBeenCalled();
    expect(prismaMock.dailyOfflineStock.groupBy).not.toHaveBeenCalled();
  });

  it("applies to each entry page the same way", async () => {
    rules.requireEarlierDaysFinished = false;
    await expect(assertEarlierDaysFinished(TODAY, undefined, "ONLINE")).resolves.toBeUndefined();
    await expect(assertEarlierDaysFinished(TODAY, undefined, "OFFLINE")).resolves.toBeUndefined();
  });
});

describe("finishing a day stays in order, whatever the rule says", () => {
  it("still names the unfinished earlier day when the rule is off", async () => {
    rules.requireEarlierDaysFinished = false;
    expect(await findUnfinishedEarlierPeriod(TODAY, undefined, undefined, "finish")).toEqual({ entryDate: "2026-10-09", shift: "NIGHT" });
  });

  it("refuses to finish a later day while an earlier one is open, even with the rule off", async () => {
    rules.requireEarlierDaysFinished = false;
    await expect(assertEarlierDaysFinished(TODAY, undefined, "ONLINE", "finish")).rejects.toMatchObject({ status: 409 });
  });

  it("lets the earlier day itself be finished (nothing is earlier than it)", async () => {
    prismaMock.dayClosure.findFirst.mockResolvedValue({ entryDate: D("2026-10-09") });
    await expect(assertEarlierDaysFinished(D("2026-10-09"), undefined, "ONLINE", "finish")).resolves.toBeUndefined();
  });
});

describe("the day status the pages read", () => {
  it("reports the same blocker for entering and finishing while the rule is on", async () => {
    const status = await getClosureStatus(TODAY, "NIGHT", "ONLINE");
    expect(status.blockedBy).toEqual({ entryDate: "2026-10-09", shift: "NIGHT" });
    expect(status.entryBlockedBy).toEqual(status.blockedBy);
  });

  it("stops blocking entry but keeps blocking Finish when the rule is off", async () => {
    rules.requireEarlierDaysFinished = false;
    const status = await getClosureStatus(TODAY, "NIGHT", "ONLINE");
    expect(status.entryBlockedBy).toBeNull();
    expect(status.blockedBy).toEqual({ entryDate: "2026-10-09", shift: "NIGHT" });
  });

  it("reports nothing when no earlier day is open, rule on or off", async () => {
    prismaMock.dailyOnlineStock.groupBy.mockResolvedValue([]);
    for (const required of [true, false]) {
      rules.requireEarlierDaysFinished = required;
      const status = await getClosureStatus(TODAY, "NIGHT", "ONLINE");
      expect(status.blockedBy).toBeNull();
      expect(status.entryBlockedBy).toBeNull();
    }
  });
});

describe("an approved correction", () => {
  it("is never blocked by an unfinished earlier day, whatever the rule", async () => {
    for (const required of [true, false]) {
      rules.requireEarlierDaysFinished = required;
      await expect(runAsAdjustment(() => assertEarlierDaysFinished(TODAY, undefined, "ONLINE", "finish"))).resolves.toBeUndefined();
    }
  });
});
