import { beforeEach, describe, expect, it, vi } from "vitest";

const prismaMock = vi.hoisted(() => ({
  appSetting: { findMany: vi.fn(), upsert: vi.fn() },
}));
vi.mock("../lib/prisma", () => ({ prisma: prismaMock }));
vi.mock("./changeLog.service", () => ({ logSystemEvent: vi.fn() }));
vi.mock("../lib/realtime", () => ({ broadcastRealtimeEvent: vi.fn() }));

import { invalidateAll } from "../lib/cache";
import { broadcastRealtimeEvent } from "../lib/realtime";
import { logSystemEvent } from "./changeLog.service";
import { ENTRY_RULE_DEFAULTS, getEntryRules, setEntryRules } from "./appSettings.service";

const KEY = "entry.requireEarlierDaysFinished";

beforeEach(() => {
  vi.clearAllMocks();
  invalidateAll();
  prismaMock.appSetting.findMany.mockResolvedValue([]);
  prismaMock.appSetting.upsert.mockResolvedValue({});
});

describe("getEntryRules", () => {
  it("keeps the long-standing behaviour (finish in order, shifts on) when nothing has been set", async () => {
    expect(await getEntryRules()).toEqual({ requireEarlierDaysFinished: true, useShifts: true });
    expect(ENTRY_RULE_DEFAULTS.requireEarlierDaysFinished).toBe(true);
  });

  it("reads an admin's choice to turn it off", async () => {
    prismaMock.appSetting.findMany.mockResolvedValue([{ key: KEY, value: "false" }]);
    expect(await getEntryRules()).toEqual({ requireEarlierDaysFinished: false, useShifts: true });
  });

  it("treats any value other than the word false as on, so a damaged row cannot switch the rule off", async () => {
    for (const value of ["true", "", "0", "no", "FALSE "]) {
      invalidateAll();
      prismaMock.appSetting.findMany.mockResolvedValue([{ key: KEY, value }]);
      expect((await getEntryRules()).requireEarlierDaysFinished).toBe(true);
    }
  });

  it("only reads the database once for a burst of saves", async () => {
    await getEntryRules();
    await getEntryRules();
    await getEntryRules();
    expect(prismaMock.appSetting.findMany).toHaveBeenCalledTimes(1);
  });

  it("falls back to the default, rather than failing a save, when the setting cannot be read", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    prismaMock.appSetting.findMany.mockRejectedValue(new Error("Table 'app_settings' doesn't exist"));
    expect(await getEntryRules()).toEqual({ requireEarlierDaysFinished: true, useShifts: true });
    expect(error).toHaveBeenCalled();
    error.mockRestore();
  });
});

describe("shifts switch", () => {
  it("defaults to two shifts a day, and is switched off only by the word false", async () => {
    expect((await getEntryRules()).useShifts).toBe(true);
    invalidateAll();
    prismaMock.appSetting.findMany.mockResolvedValue([{ key: "entry.useShifts", value: "false" }]);
    expect((await getEntryRules()).useShifts).toBe(false);
    for (const value of ["true", "", "0", "no", "FALSE "]) {
      invalidateAll();
      prismaMock.appSetting.findMany.mockResolvedValue([{ key: "entry.useShifts", value }]);
      expect((await getEntryRules()).useShifts, value).toBe(true);
    }
  });

  it("is stored under its own key", async () => {
    await setEntryRules({ useShifts: false }, 7);
    expect(prismaMock.appSetting.upsert).toHaveBeenCalledWith({
      where: { key: "entry.useShifts" },
      create: { key: "entry.useShifts", value: "false", updatedById: 7 },
      update: { value: "false", updatedById: 7 },
    });
  });
});

describe("setEntryRules", () => {
  it("stores the switch under its key, recording who changed it", async () => {
    prismaMock.appSetting.findMany.mockResolvedValue([{ key: KEY, value: "false" }]);
    const result = await setEntryRules({ requireEarlierDaysFinished: false }, 7);
    expect(prismaMock.appSetting.upsert).toHaveBeenCalledWith({
      where: { key: KEY },
      create: { key: KEY, value: "false", updatedById: 7 },
      update: { value: "false", updatedById: 7 },
    });
    expect(result).toEqual({ requireEarlierDaysFinished: false, useShifts: true });
  });

  it("takes effect at once, not after the cache expires", async () => {
    expect((await getEntryRules()).requireEarlierDaysFinished).toBe(true);
    prismaMock.appSetting.findMany.mockResolvedValue([{ key: KEY, value: "false" }]);
    await setEntryRules({ requireEarlierDaysFinished: false }, 7);
    expect((await getEntryRules()).requireEarlierDaysFinished).toBe(false);
  });

  it("is written to the change log, and open pages are told to re-read", async () => {
    await setEntryRules({ requireEarlierDaysFinished: false }, 7);
    expect(logSystemEvent).toHaveBeenCalledWith("entry_rules", { requireEarlierDaysFinished: false }, 7, "UPDATE");
    expect(broadcastRealtimeEvent).toHaveBeenCalled();
  });
});
