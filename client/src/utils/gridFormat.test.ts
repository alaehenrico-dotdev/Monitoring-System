import { describe, expect, it } from "vitest";
import {
  formatGridNumber,
  formatPercentOfTotal,
  isUnusualJump,
  isValidStockValue,
  ZERO_DASH,
} from "./gridFormat";

describe("formatGridNumber", () => {
  it("renders zero, null, undefined and blank as the dash", () => {
    for (const v of [0, null, undefined, ""]) {
      expect(formatGridNumber(v)).toEqual({ text: ZERO_DASH, isZero: true });
    }
  });

  it("groups thousands for real values", () => {
    expect(formatGridNumber(1234567).text).toBe((1234567).toLocaleString());
    expect(formatGridNumber(1234567).isZero).toBe(false);
  });

  it("treats a non-numeric value as empty rather than printing NaN", () => {
    expect(formatGridNumber("abc")).toEqual({ text: ZERO_DASH, isZero: true });
  });

  it("keeps negatives visible - they are the thing worth noticing", () => {
    expect(formatGridNumber(-42).text).toBe((-42).toLocaleString());
    expect(formatGridNumber(-42).isZero).toBe(false);
  });
});

describe("formatPercentOfTotal", () => {
  it("renders a share to one decimal", () => {
    expect(formatPercentOfTotal(25, 200)).toBe("12.5%");
  });

  it("dashes a zero total rather than printing 0.0% on every row", () => {
    expect(formatPercentOfTotal(0, 0)).toBe(ZERO_DASH);
  });

  it("dashes a zero row in a non-empty column", () => {
    expect(formatPercentOfTotal(0, 500)).toBe(ZERO_DASH);
  });
});

describe("isValidStockValue", () => {
  it("accepts zero, positives and a blank cell", () => {
    expect(isValidStockValue("0")).toBe(true);
    expect(isValidStockValue("1250")).toBe(true);
    expect(isValidStockValue("")).toBe(true);
  });

  it("rejects negatives - stock is a count of physical product", () => {
    expect(isValidStockValue("-1")).toBe(false);
  });

  it("rejects non-numeric input", () => {
    expect(isValidStockValue("abc")).toBe(false);
  });
});

describe("isUnusualJump", () => {
  it("flags an order-of-magnitude jump from a real saved figure", () => {
    expect(isUnusualJump(5000, 100)).toBe(true);
  });

  it("ignores first entry on a cell that was empty", () => {
    // 0 -> 500 is ordinary first entry, not an anomaly.
    expect(isUnusualJump(500, 0)).toBe(false);
  });

  it("ignores small absolute changes even when proportionally large", () => {
    // 1 -> 20 is 20x but only 19 units; below the absolute floor.
    expect(isUnusualJump(20, 1)).toBe(false);
  });

  it("ignores an ordinary day-to-day change", () => {
    expect(isUnusualJump(1300, 1200)).toBe(false);
  });
});
