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
import { ENTRY_RULE_DEFAULTS, getEntryRules, getReportOptions, REPORT_OPTION_DEFAULTS, setEntryRules, setReportOptions } from "./appSettings.service";

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

describe("report options (what the Drive PDF leaves out)", () => {
  it("are both OFF when nothing has been set, so the report lists everything as it always did", async () => {
    expect(await getReportOptions()).toEqual({ hideEmptyRows: false, hideEmptyColumns: false });
    expect(REPORT_OPTION_DEFAULTS).toEqual({ hideEmptyRows: false, hideEmptyColumns: false });
  });

  it("read an admin's choice to turn each on", async () => {
    prismaMock.appSetting.findMany.mockResolvedValue([{ key: "report.hideEmptyRows", value: "true" }]);
    expect(await getReportOptions()).toEqual({ hideEmptyRows: true, hideEmptyColumns: false });
    prismaMock.appSetting.findMany.mockResolvedValue([
      { key: "report.hideEmptyRows", value: "true" },
      { key: "report.hideEmptyColumns", value: "true" },
    ]);
    expect(await getReportOptions()).toEqual({ hideEmptyRows: true, hideEmptyColumns: true });
  });

  it("treat anything other than the word true as off, so a damaged row cannot start hiding data", async () => {
    for (const value of ["false", "", "1", "yes", "TRUE "]) {
      prismaMock.appSetting.findMany.mockResolvedValue([{ key: "report.hideEmptyRows", value }]);
      expect((await getReportOptions()).hideEmptyRows).toBe(false);
    }
  });

  it("fall back to showing everything when the database cannot be read", async () => {
    prismaMock.appSetting.findMany.mockRejectedValue(new Error("db down"));
    expect(await getReportOptions()).toEqual({ hideEmptyRows: false, hideEmptyColumns: false });
  });

  it("are saved one row per switch, as the admin who changed them, and logged", async () => {
    await setReportOptions({ hideEmptyRows: true }, 7);
    expect(prismaMock.appSetting.upsert).toHaveBeenCalledTimes(1);
    expect(prismaMock.appSetting.upsert.mock.calls[0][0]).toMatchObject({
      where: { key: "report.hideEmptyRows" },
      create: { key: "report.hideEmptyRows", value: "true", updatedById: 7 },
      update: { value: "true", updatedById: 7 },
    });
    expect(logSystemEvent).toHaveBeenCalledWith("report_options", { hideEmptyRows: true }, 7, "UPDATE");
  });

  it("changing one switch leaves the other alone", async () => {
    await setReportOptions({ hideEmptyColumns: false }, 7);
    expect(prismaMock.appSetting.upsert).toHaveBeenCalledTimes(1);
    expect(prismaMock.appSetting.upsert.mock.calls[0][0].where.key).toBe("report.hideEmptyColumns");
  });
});
