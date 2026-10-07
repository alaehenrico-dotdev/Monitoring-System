import { afterEach, describe, expect, it, vi } from "vitest";
import type { Request, Response } from "express";

vi.mock("../services/dashboardAnalytics.service", () => ({
  getMonthlyOverview: vi.fn().mockResolvedValue([]),
}));

function mockRes() {
  const res = { json: vi.fn() } as unknown as Response;
  return res;
}

afterEach(() => {
  vi.useRealTimers();
});

describe("getMonthlyOverviewHandler - the `year` query default", () => {
  it("defaults to whatever year it actually is right now, not whichever year was current when the server process started", async () => {
    // The module is imported exactly ONCE, before time is ever faked - the
    // same as a real server process starting up and then staying up. A
    // `const CURRENT_YEAR = new Date()...` evaluated once at module load
    // would freeze on whatever year that one import happened to run in;
    // computing it fresh per request is what lets the SAME already-running
    // handler still pick up the real year after time moves on, with no
    // module reload (no server restart) in between.
    const { getMonthlyOverviewHandler } = await import("./dashboardAnalytics.controller.js");
    const { getMonthlyOverview } = await import("../services/dashboardAnalytics.service.js");

    vi.useFakeTimers();

    vi.setSystemTime(new Date("2026-06-15T00:00:00.000Z"));
    await getMonthlyOverviewHandler({ query: {} } as unknown as Request, mockRes());
    expect(vi.mocked(getMonthlyOverview)).toHaveBeenLastCalledWith(2026);

    vi.setSystemTime(new Date("2027-01-02T00:00:00.000Z"));
    await getMonthlyOverviewHandler({ query: {} } as unknown as Request, mockRes());
    expect(vi.mocked(getMonthlyOverview)).toHaveBeenLastCalledWith(2027);
  });

  it("still rejects a year more than one year in the future, using the CURRENT current year as the ceiling", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-06-15T00:00:00.000Z"));
    vi.resetModules();
    const { getMonthlyOverviewHandler } = await import("./dashboardAnalytics.controller.js");

    const req = { query: { year: "2028" } } as unknown as Request;
    await expect(getMonthlyOverviewHandler(req, mockRes())).rejects.toThrow(/Invalid `year`/);
  });
});
