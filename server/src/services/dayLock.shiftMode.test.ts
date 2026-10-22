import { beforeEach, describe, expect, it, vi } from "vitest";

const prismaMock = vi.hoisted(() => ({
  dayClosure: { findUnique: vi.fn() },
  monthClosure: { findUnique: vi.fn() },
  dailyOnlineStock: { findFirst: vi.fn() },
  dailyOfflineStock: { findFirst: vi.fn() },
}));
vi.mock("../lib/prisma", () => ({ prisma: prismaMock }));
vi.mock("./changeLog.service", () => ({ recordChange: vi.fn() }));
vi.mock("../lib/realtime", () => ({ broadcastRealtimeEvent: vi.fn() }));
const rules = vi.hoisted(() => ({ requireEarlierDaysFinished: true, useShifts: true }));
vi.mock("./appSettings.service", () => ({ getEntryRules: vi.fn(async () => ({ ...rules })) }));

import { assertPeriodOpen, runAsAdjustment } from "./dayLock.service";

const DAY = new Date("2026-10-14T00:00:00.000Z");

beforeEach(() => {
  vi.clearAllMocks();
  rules.useShifts = true;
  prismaMock.monthClosure.findUnique.mockResolvedValue(null);
  prismaMock.dayClosure.findUnique.mockResolvedValue(null);
  prismaMock.dailyOnlineStock.findFirst.mockResolvedValue(null);
  prismaMock.dailyOfflineStock.findFirst.mockResolvedValue(null);
});

describe("whole-day mode (shifts switched off)", () => {
  it("changes nothing while shifts are on", async () => {
    await expect(assertPeriodOpen(DAY, "MORNING")).resolves.toBeUndefined();
    await expect(assertPeriodOpen(DAY, "NIGHT")).resolves.toBeUndefined();
    expect(prismaMock.dailyOnlineStock.findFirst).not.toHaveBeenCalled();
  });

  it("refuses to write a Morning sheet", async () => {
    rules.useShifts = false;
    await expect(assertPeriodOpen(DAY, "MORNING")).rejects.toMatchObject({ status: 400 });
    await expect(assertPeriodOpen(DAY, "MORNING", undefined, "count")).rejects.toMatchObject({ status: 400 });
  });

  it("lets the whole-day (Night) sheet be written on a day with no Morning entries", async () => {
    rules.useShifts = false;
    await expect(assertPeriodOpen(DAY, "NIGHT", undefined, "entry", "ONLINE")).resolves.toBeUndefined();
  });

  it("keeps a day that was entered by shift read-only, but still lets it be counted", async () => {
    rules.useShifts = false;
    prismaMock.dailyOnlineStock.findFirst.mockResolvedValue({ id: 1 });
    await expect(assertPeriodOpen(DAY, "NIGHT", undefined, "entry", "ONLINE")).rejects.toMatchObject({
      status: 409,
      message: expect.stringContaining("read-only"),
    });
    await expect(assertPeriodOpen(DAY, "NIGHT", undefined, "count")).resolves.toBeUndefined();
  });

  it("also treats an Offline-only Morning entry as a shift-entered day", async () => {
    rules.useShifts = false;
    prismaMock.dailyOfflineStock.findFirst.mockResolvedValue({ id: 2 });
    await expect(assertPeriodOpen(DAY, "NIGHT", undefined, "entry", "OFFLINE")).rejects.toMatchObject({ status: 409 });
  });

  it("does not stop an approved correction from fixing an old Morning row", async () => {
    rules.useShifts = false;
    await expect(runAsAdjustment(() => assertPeriodOpen(DAY, "MORNING"))).resolves.toBeUndefined();
  });
});
