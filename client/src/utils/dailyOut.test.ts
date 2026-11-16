import { describe, expect, it } from "vitest";
import type { DailyOutEntry } from "../api/dailyOut";
import { DAILY_OUT_SERIES, dailyOutCsv, dailyOutFlowPoints, dailyOutTotals } from "./dailyOut";

const day = (date: string, onlineOut: number | null, offlineOut: number | null, onlineRts: number | null = null, offlineBackloads: number | null = null): DailyOutEntry => ({
  date,
  onlineOut,
  onlineRts,
  offlineOut,
  offlineBackloads,
  totalOut: onlineOut === null && offlineOut === null ? null : (onlineOut ?? 0) + (offlineOut ?? 0),
});

const ROWS = [day("2026-10-01", 120, 80, 5, 20), day("2026-10-02", null, null), day("2026-10-03", 50, null, 2, null)];

describe("dailyOutFlowPoints", () => {
  const points = dailyOutFlowPoints(ROWS, "2026-10-03");

  it("maps combined, online and offline onto the dashboard chart's series keys", () => {
    expect(DAILY_OUT_SERIES.map((s) => s.key)).toEqual(["total", "online", "offline"]);
    expect(points[0].values).toEqual({ total: 200, online: 120, offline: 80 });
  });

  it("keeps a day with nothing recorded as null, and marks only today as current", () => {
    expect(points[1].values).toEqual({ total: null, online: null, offline: null });
    expect(points.map((p) => p.current)).toEqual([false, false, true]);
  });
});

describe("dailyOutTotals", () => {
  it("sums each side, counting only days that have an entry", () => {
    expect(dailyOutTotals(ROWS)).toEqual({ onlineOut: 170, onlineRts: 7, offlineOut: 80, offlineBackloads: 20, totalOut: 250, days: 2 });
  });

  it("is all zero for an empty period", () => {
    expect(dailyOutTotals([day("2026-10-01", null, null)])).toEqual({ onlineOut: 0, onlineRts: 0, offlineOut: 0, offlineBackloads: 0, totalOut: 0, days: 0 });
  });
});

describe("dailyOutCsv", () => {
  it("exports a blank cell, not a zero, where nothing was recorded", () => {
    const lines = dailyOutCsv(ROWS).split(/\r?\n/);
    expect(lines[0]).toBe("Date,Online Out,Online RTS,Offline Out,Offline Backloads,Combined Out");
    expect(lines[1]).toBe("2026-10-01,120,5,80,20,200");
    expect(lines[2]).toBe("2026-10-02,,,,,");
    expect(lines[3]).toBe("2026-10-03,50,2,,,50");
  });
});
