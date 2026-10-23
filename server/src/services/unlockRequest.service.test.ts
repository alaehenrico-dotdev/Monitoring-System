import { beforeEach, describe, expect, it, vi } from "vitest";

const prismaMock = vi.hoisted(() => ({
  dayClosure: { findUnique: vi.fn() },
  dailyOnlineStock: { findFirst: vi.fn() },
  dailyOfflineStock: { findFirst: vi.fn() },
  unlockRequest: { findFirst: vi.fn(), create: vi.fn() },
}));
vi.mock("../lib/prisma", () => ({ prisma: prismaMock }));
vi.mock("../lib/realtime", () => ({ broadcastRealtimeEvent: vi.fn() }));
const logSystemEvent = vi.hoisted(() => vi.fn());
vi.mock("./changeLog.service", () => ({ logSystemEvent }));
const findUnfinishedEarlierPeriod = vi.hoisted(() => vi.fn());
const rules = vi.hoisted(() => ({ useShifts: true }));
vi.mock("./appSettings.service", () => ({ getEntryRules: vi.fn(async () => ({ requireEarlierDaysFinished: true, ...rules })) }));
vi.mock("./dayLock.service", () => ({ findUnfinishedEarlierPeriod, isSideLocked: (row: { onlineLocked: boolean; offlineLocked: boolean } | null, loc: string) => !!row && (loc === "ONLINE" ? row.onlineLocked : row.offlineLocked) }));

import { requestUnlock } from "./unlockRequest.service";

const DATE = new Date("2026-10-14T00:00:00.000Z");
const input = { location: "OFFLINE" as const, entryDate: DATE, shift: "NIGHT" as const, reason: "Delivery 2 was typed on the wrong row" };

describe("requestUnlock", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    findUnfinishedEarlierPeriod.mockResolvedValue(null);
    rules.useShifts = true;
    prismaMock.dailyOnlineStock.findFirst.mockResolvedValue(null);
    prismaMock.dailyOfflineStock.findFirst.mockResolvedValue(null);
    prismaMock.dayClosure.findUnique.mockResolvedValue({ onlineLocked: false, offlineLocked: true });
    prismaMock.unlockRequest.findFirst.mockResolvedValue(null);
    prismaMock.unlockRequest.create.mockResolvedValue({ id: 3, reason: input.reason, requestedAt: new Date() });
  });

  it("records the ask and logs it", async () => {
    const r = await requestUnlock(input, 7);
    expect(r).toMatchObject({ id: 3, alreadyRequested: false });
    expect(prismaMock.unlockRequest.create.mock.calls[0][0].data).toMatchObject({ location: "OFFLINE", requestedById: 7 });
    expect(logSystemEvent).toHaveBeenCalledWith("unlock_request", expect.objectContaining({ location: "OFFLINE" }), 7);
  });

  it("refuses a page that is not finished", async () => {
    await expect(requestUnlock({ ...input, location: "ONLINE" }, 7)).rejects.toThrow(/open for entry/);
    expect(prismaMock.unlockRequest.create).not.toHaveBeenCalled();
  });

  it("accepts a page that is held up by an earlier unfinished day, not finished itself", async () => {
    prismaMock.dayClosure.findUnique.mockResolvedValue(null);
    findUnfinishedEarlierPeriod.mockResolvedValue({ entryDate: "2026-10-12", shift: "NIGHT" });
    expect(await requestUnlock(input, 7)).toMatchObject({ alreadyRequested: false });
  });

  it("accepts a day entered by shift while shifts are off (its whole-day view is read-only)", async () => {
    prismaMock.dayClosure.findUnique.mockResolvedValue(null);
    rules.useShifts = false;
    prismaMock.dailyOfflineStock.findFirst.mockResolvedValue({ id: 5 });
    expect(await requestUnlock(input, 7)).toMatchObject({ alreadyRequested: false });
  });

  it("does not treat a plain whole-day sheet as locked", async () => {
    prismaMock.dayClosure.findUnique.mockResolvedValue(null);
    rules.useShifts = false;
    await expect(requestUnlock(input, 7)).rejects.toThrow(/open for entry/);
  });

  it("refuses a missing or too-short reason", async () => {
    await expect(requestUnlock({ ...input, reason: " ok " }, 7)).rejects.toThrow(/reason/);
  });

  it("returns the request already waiting instead of adding a second", async () => {
    prismaMock.unlockRequest.findFirst.mockResolvedValue({ id: 2, reason: "earlier", requestedAt: new Date() });
    const r = await requestUnlock(input, 7);
    expect(r).toMatchObject({ id: 2, alreadyRequested: true });
    expect(prismaMock.unlockRequest.create).not.toHaveBeenCalled();
  });
});
