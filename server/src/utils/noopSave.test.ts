import { describe, expect, it } from "vitest";
import { isNoopSave } from "./noopSave";

const existing = { openingStock: "10.00", productionIn: "5.00", fulfillmentOut: "2.00" };

describe("isNoopSave", () => {
  it("is true when every figure matches (Decimal strings included)", () => {
    expect(isNoopSave(existing, 10, { productionIn: 5, fulfillmentOut: 2 }, 0)).toBe(true);
  });
  it("is false when one figure differs", () => {
    expect(isNoopSave(existing, 10, { productionIn: 6, fulfillmentOut: 2 }, 0)).toBe(false);
  });
  it("is false when the opening stock differs", () => {
    expect(isNoopSave(existing, 11, { productionIn: 5, fulfillmentOut: 2 }, 0)).toBe(false);
  });
  it("is false for a new row", () => {
    expect(isNoopSave(null, 0, { productionIn: 0 }, 0)).toBe(false);
  });
  it("is false when added-column amounts are being replaced", () => {
    expect(isNoopSave(existing, 10, { productionIn: 5, fulfillmentOut: 2 }, 1)).toBe(false);
  });
});
