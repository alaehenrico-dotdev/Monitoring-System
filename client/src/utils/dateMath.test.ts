import { describe, expect, it } from "vitest";
import { addDaysIso, previousMonth, yearMonthOf } from "./dateMath";

describe("addDaysIso", () => {
  it("moves across month and year boundaries", () => {
    expect(addDaysIso("2026-10-01", -1)).toBe("2026-09-30");
    expect(addDaysIso("2026-12-31", 1)).toBe("2027-01-01");
    expect(addDaysIso("2026-03-01", -1)).toBe("2026-02-28");
  });

  it("knows leap years", () => {
    expect(addDaysIso("2028-03-01", -1)).toBe("2028-02-29");
  });

  it("is the identity for zero", () => {
    expect(addDaysIso("2026-10-17", 0)).toBe("2026-10-17");
  });
});

describe("month helpers", () => {
  it("takes the month off a date", () => {
    expect(yearMonthOf("2026-10-17")).toBe("2026-10");
  });

  it("steps back a month, across a year", () => {
    expect(previousMonth("2026-10")).toBe("2026-09");
    expect(previousMonth("2027-01")).toBe("2026-12");
  });
});
