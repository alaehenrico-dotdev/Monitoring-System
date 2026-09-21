import { describe, expect, it } from "vitest";
import {
  calculateOfflineRemaining,
  calculateOfflineStock,
  calculateOnlineRemaining,
  calculateOnlineStock,
  calculateVariance,
  isNegativeStock,
  toNum,
} from "./stockMath";

describe("toNum", () => {
  it("passes real numbers through", () => {
    expect(toNum(42)).toBe(42);
    expect(toNum(-3.5)).toBe(-3.5);
  });

  it("treats null/undefined as 0 - a product with no entry yet, not a data error", () => {
    expect(toNum(null)).toBe(0);
    expect(toNum(undefined)).toBe(0);
  });

  it("coerces Prisma's Decimal-as-string values", () => {
    // Prisma returns Decimal columns as strings by default - every caller
    // of toNum ultimately feeds it one of these, not a plain JS number.
    expect(toNum("12.50")).toBe(12.5);
    expect(toNum("0")).toBe(0);
  });
});

describe("calculateOnlineStock (Section 4.2)", () => {
  it("is opening + in - out", () => {
    expect(calculateOnlineStock(100, 20, 5)).toBe(115);
  });

  it("can go negative when Out exceeds Opening+In - a real over-issue, not clamped to 0", () => {
    expect(calculateOnlineStock(10, 0, 15)).toBe(-5);
  });
});

describe("calculateOnlineRemaining (Section 4.2)", () => {
  it("is onlineStock + production - fulfillment + rts", () => {
    expect(calculateOnlineRemaining(115, 10, 20, 2)).toBe(107);
  });
});

describe("calculateOfflineStock (Section 4.3)", () => {
  it("is opening + in - out", () => {
    expect(calculateOfflineStock(50, 5, 10)).toBe(45);
  });
});

describe("calculateOfflineRemaining (Section 4.3)", () => {
  it("is offlineStock + production - delivery + backloads", () => {
    expect(calculateOfflineRemaining(45, 8, 12, 3)).toBe(44);
  });
});

describe("calculateVariance (Section 4.4)", () => {
  it("is system remaining minus manual count", () => {
    expect(calculateVariance(100, 95)).toBe(5);
  });

  it("is negative when the physical count is HIGHER than system stock", () => {
    // A meaningful case to pin down: on the Variance Report a negative
    // number means an *overage* (more counted than the system expected),
    // not an error - flipping this sign anywhere would silently invert
    // every overage/shortage on the report.
    expect(calculateVariance(90, 100)).toBe(-10);
  });

  it("is 0 when the count matches exactly - not flagged as a variance", () => {
    expect(calculateVariance(50, 50)).toBe(0);
  });
});

describe("isNegativeStock", () => {
  it("flags a negative Remaining Stock", () => {
    expect(isNegativeStock(-0.01)).toBe(true);
    expect(isNegativeStock(-100)).toBe(true);
  });

  it("does not flag zero or a positive Remaining Stock", () => {
    // Exactly zero (fully depleted, but not over-issued) is a valid,
    // allowed balance - only actually negative is rejected.
    expect(isNegativeStock(0)).toBe(false);
    expect(isNegativeStock(1)).toBe(false);
  });
});
