import { describe, expect, it } from "vitest";
import type { GridRow } from "../components/StockGrid";
import { belowZeroWarnings } from "./finishWarnings";

// Only the figures hasNegativeValue reads matter here.
const row = (id: number, remainingStock: number) => ({ product: { id }, entry: { remainingStock, openingStock: 0, onlineStock: 0 } }) as unknown as GridRow;

describe("belowZeroWarnings", () => {
  it("is quiet when nothing is below zero, or the sheet has not loaded", () => {
    expect(belowZeroWarnings([row(1, 5), row(2, 0)])).toEqual([]);
    expect(belowZeroWarnings(null)).toEqual([]);
    expect(belowZeroWarnings([])).toEqual([]);
  });

  it("says how many products end below zero, in the singular and the plural", () => {
    expect(belowZeroWarnings([row(1, -1), row(2, 3)])).toEqual(["1 product ends below zero stock on this sheet."]);
    expect(belowZeroWarnings([row(1, -1), row(2, -4), row(3, 3)])).toEqual(["2 products end below zero stock on this sheet."]);
  });
});
