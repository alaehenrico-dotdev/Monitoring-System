import { beforeEach, describe, expect, it, vi } from "vitest";

const http = vi.hoisted(() => ({ get: vi.fn() }));
vi.mock("./http", () => ({ http }));

import { getDailyOut, normalizeDailyOutEntry } from "./dailyOut";

beforeEach(() => http.get.mockReset());

// During a deploy the browser can run the new page against a server that predates the RTS and
// Backloads figures. That server sends no such fields; the page must show "nothing recorded", not NaN.
describe("Daily Out from a server without the RTS and Backloads figures", () => {
  it("reads a missing figure as null, and keeps the ones that are there", () => {
    expect(normalizeDailyOutEntry({ date: "2026-10-01", onlineOut: 120, offlineOut: 80, totalOut: 200 })).toEqual({
      date: "2026-10-01",
      onlineOut: 120,
      onlineRts: null,
      offlineOut: 80,
      offlineBackloads: null,
      totalOut: 200,
    });
  });

  it("keeps a real zero as zero - only a missing figure becomes null", () => {
    const e = normalizeDailyOutEntry({ date: "2026-10-01", onlineOut: 0, onlineRts: 0, offlineOut: 0, offlineBackloads: 0, totalOut: 0 });
    expect(e).toMatchObject({ onlineOut: 0, onlineRts: 0, offlineOut: 0, offlineBackloads: 0, totalOut: 0 });
  });

  it("normalises every row of the response", async () => {
    http.get.mockResolvedValue([
      { date: "2026-10-01", onlineOut: 5, offlineOut: 2, totalOut: 7 },
      { date: "2026-10-02", onlineOut: null, offlineOut: null, totalOut: null },
    ]);
    const rows = await getDailyOut("2026-10-01", "2026-10-02");
    expect(http.get).toHaveBeenCalledWith("/total-stocks/daily-out?from=2026-10-01&to=2026-10-02");
    expect(rows.map((r) => [r.onlineRts, r.offlineBackloads])).toEqual([
      [null, null],
      [null, null],
    ]);
    expect(rows[0]).toMatchObject({ onlineOut: 5, offlineOut: 2, totalOut: 7 });
  });

  it("passes the new figures straight through from a current server", async () => {
    http.get.mockResolvedValue([{ date: "2026-10-01", onlineOut: 5, onlineRts: 1, offlineOut: 2, offlineBackloads: 3, totalOut: 7 }]);
    const [row] = await getDailyOut("2026-10-01", "2026-10-01");
    expect(row).toMatchObject({ onlineRts: 1, offlineBackloads: 3 });
  });
});
