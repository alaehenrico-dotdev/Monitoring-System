import { describe, expect, it } from "vitest";
import { backloadRate, deltaOf, periodRange, shiftPeriod } from "./periodMonitoring";

describe("periodRange", () => {
  it("runs a week Monday to Sunday, wherever in the week the date falls", () => {
    // 2026-10-07 is a Wednesday; 2026-10-11 is a Sunday.
    expect(periodRange("week", "2026-10-07")).toEqual({ from: "2026-10-05", to: "2026-10-11" });
    expect(periodRange("week", "2026-10-11")).toEqual({ from: "2026-10-05", to: "2026-10-11" });
    expect(periodRange("week", "2026-10-05")).toEqual({ from: "2026-10-05", to: "2026-10-11" });
  });

  it("covers the whole calendar month, including a leap February", () => {
    expect(periodRange("month", "2026-10-17")).toEqual({ from: "2026-10-01", to: "2026-10-31" });
    expect(periodRange("month", "2028-02-10")).toEqual({ from: "2028-02-01", to: "2028-02-29" });
  });

  it("weeks that cross a month or year boundary stay seven days", () => {
    expect(periodRange("week", "2026-12-31")).toEqual({ from: "2026-12-28", to: "2027-01-03" });
  });
});

describe("shiftPeriod", () => {
  it("moves by whole weeks and whole months", () => {
    expect(periodRange("week", shiftPeriod("week", "2026-10-07", -1))).toEqual({ from: "2026-09-28", to: "2026-10-04" });
    expect(periodRange("month", shiftPeriod("month", "2026-03-31", -1))).toEqual({ from: "2026-02-01", to: "2026-02-28" });
    expect(periodRange("month", shiftPeriod("month", "2026-01-15", -1))).toEqual({ from: "2025-12-01", to: "2025-12-31" });
  });
});

describe("deltaOf / backloadRate", () => {
  it("gives a change and a percentage, and no percentage against zero", () => {
    expect(deltaOf(110, 100)).toEqual({ diff: 10, pct: 10 });
    expect(deltaOf(5, 0)).toEqual({ diff: 5, pct: null });
    expect(deltaOf(5, undefined)).toBeNull();
  });

  it("is a share of gross outflow, null when nothing went out", () => {
    const t = { totalOut: 90, backloads: 10 } as never;
    expect(backloadRate(t)).toBe(10);
    expect(backloadRate({ totalOut: 0, backloads: 0 } as never)).toBeNull();
  });
});
