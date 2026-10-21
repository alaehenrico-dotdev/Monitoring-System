import { describe, expect, it, vi } from "vitest";
import type { Request, Response } from "express";

vi.mock("../services/totalStocks.service", () => ({ getTotalStocksGrid: vi.fn() }));
vi.mock("../services/dailyOutflow.service", () => ({
  MAX_OUTFLOW_DAYS: 366,
  getDailyOutflow: vi.fn().mockResolvedValue([]),
}));

import { getDailyOutflowHandler } from "./totalStocks.controller";
import { getDailyOutflow } from "../services/dailyOutflow.service";

const call = (query: Record<string, string>) =>
  getDailyOutflowHandler({ query } as unknown as Request, { json: vi.fn() } as unknown as Response);

describe("getDailyOutflowHandler", () => {
  it("passes a valid range through as UTC dates", async () => {
    await call({ from: "2026-10-01", to: "2026-10-14" });
    expect(getDailyOutflow).toHaveBeenLastCalledWith(new Date("2026-10-01T00:00:00Z"), new Date("2026-10-14T00:00:00Z"));
  });

  it("rejects a missing bound", async () => {
    await expect(call({ from: "2026-10-01" })).rejects.toThrow(/from.*to/);
  });

  it("rejects malformed and impossible dates", async () => {
    await expect(call({ from: "10/01/2026", to: "2026-10-14" })).rejects.toThrow();
    await expect(call({ from: "2026-02-30", to: "2026-03-05" })).rejects.toThrow(/Invalid date/);
  });

  it("rejects a range that ends before it starts", async () => {
    await expect(call({ from: "2026-10-14", to: "2026-10-01" })).rejects.toThrow(/before/);
  });

  it("rejects a range longer than a year, but allows exactly 366 days", async () => {
    await expect(call({ from: "2025-01-01", to: "2026-10-01" })).rejects.toThrow(/at most 366 days/);
    await expect(call({ from: "2026-01-01", to: "2026-12-31" })).resolves.toBeUndefined();
  });
});
