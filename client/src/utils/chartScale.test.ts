import { describe, expect, it } from "vitest";
import { niceScale } from "./chartScale";

describe("niceScale", () => {
  it("ends the axis on a round number at or above the data maximum", () => {
    expect(niceScale(37_400)).toEqual({ max: 40_000, ticks: [0, 10_000, 20_000, 30_000, 40_000] });
    expect(niceScale(100)).toEqual({ max: 100, ticks: [0, 25, 50, 75, 100] });
  });

  it("never lets the top tick fall below the data", () => {
    for (const v of [1, 7, 99, 101, 1234, 56_789, 2_500_000]) {
      expect(niceScale(v).max).toBeGreaterThanOrEqual(v);
    }
  });

  it("keeps a drawable axis when there is no data or it is all zero", () => {
    expect(niceScale(0)).toEqual({ max: 4, ticks: [0, 1, 2, 3, 4] });
    expect(niceScale(Number.NaN).ticks).toEqual([0, 1, 2, 3, 4]);
  });

  it("never uses a fractional step, which the axis labels would round into nonsense", () => {
    for (const v of [0, 0.3, 1, 2, 3.9]) {
      expect(niceScale(v).ticks.every(Number.isInteger)).toBe(true);
    }
  });
});
