import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { daysAgo } from "./VarianceReportPage";

// This machine (and this app's real deployment) runs in Asia/Manila, UTC+8 -
// the exact window this guards against is local midnight up to 8am, where
// `new Date().toISOString()` still reads the PREVIOUS UTC day.
describe("daysAgo", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("is today's own local calendar date for n=0, even at 2am local time", () => {
    vi.setSystemTime(new Date(2026, 5, 16, 2, 0)); // local 2026-06-16 02:00
    expect(daysAgo(0)).toBe("2026-06-16");
  });

  it("subtracts whole calendar days from the local date, not the UTC one", () => {
    vi.setSystemTime(new Date(2026, 5, 16, 2, 0));
    expect(daysAgo(1)).toBe("2026-06-15");
    expect(daysAgo(30)).toBe("2026-05-17");
  });

  it("carries the month/year backward correctly across a month/year boundary", () => {
    vi.setSystemTime(new Date(2027, 0, 1, 2, 0)); // local 2027-01-01 02:00
    expect(daysAgo(1)).toBe("2026-12-31");
  });
});
