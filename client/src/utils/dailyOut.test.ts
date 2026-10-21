import { describe, expect, it } from "vitest";
import type { DailyOutEntry } from "../api/dailyOut";
import { dailyOutCsv, dailyOutPoints, dailyOutTotals } from "./dailyOut";

const day = (date: string, onlineOut: number | null, offlineOut: number | null): DailyOutEntry => ({
  date,
  onlineOut,
  offlineOut,
  totalOut: onlineOut === null && offlineOut === null ? null : (onlineOut ?? 0) + (offlineOut ?? 0),
});

const ROWS = [day("2026-10-01", 120, 80), day("2026-10-02", null, null), day("2026-10-03", 50, null)];

describe("dailyOutPoints", () => {
  const points = dailyOutPoints(ROWS, "2026-10-03");

  it("draws the combined figure as the bar and each pool as a line", () => {
    expect(points[0]).toMatchObject({ bar: 200, online: 120, offline: 80 });
  });

  it("leaves a day with nothing recorded empty, not zero", () => {
    expect(points[1]).toMatchObject({ bar: null, online: null, offline: null });
    expect(points[1].tooltip.empty).toBe("No entries recorded");
    expect(points[1].ariaLabel).toMatch(/No entries recorded/);
  });

  it("says which side is missing when only one pool has an entry", () => {
    expect(points[2].tooltip.rows?.map((r) => r.label)).toEqual(["Combined out", "Online out"]);
    expect(points[2].tooltip.footer?.text).toBe("No Offline entry that day");
    expect(points[2].ariaLabel).toMatch(/Offline out: no entry/);
  });

  it("marks only today as current", () => {
    expect(points.map((p) => p.current)).toEqual([false, false, true]);
  });
});

describe("dailyOutTotals", () => {
  it("sums each side, counting only days that have an entry", () => {
    expect(dailyOutTotals(ROWS)).toEqual({ onlineOut: 170, offlineOut: 80, totalOut: 250, days: 2 });
  });

  it("is all zero for an empty period", () => {
    expect(dailyOutTotals([day("2026-10-01", null, null)])).toEqual({ onlineOut: 0, offlineOut: 0, totalOut: 0, days: 0 });
  });
});

describe("dailyOutCsv", () => {
  it("exports a blank cell, not a zero, where nothing was recorded", () => {
    const lines = dailyOutCsv(ROWS).split(/\r?\n/);
    expect(lines[0]).toBe("Date,Online Out,Offline Out,Combined Out");
    expect(lines[1]).toBe("2026-10-01,120,80,200");
    expect(lines[2]).toBe("2026-10-02,,,");
    expect(lines[3]).toBe("2026-10-03,50,,50");
  });
});
