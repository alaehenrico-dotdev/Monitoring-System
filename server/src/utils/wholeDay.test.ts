import { describe, expect, it } from "vitest";
import { combineSplitRows } from "./wholeDay";

const KEYS = ["productionIn", "fulfillmentOut"] as const;

describe("combineSplitRows", () => {
  it("adds the flows of both sheets and opens the day on the Morning opening", () => {
    const morning = { openingStock: 100, productionIn: 10, fulfillmentOut: 30, shift: "MORNING" };
    const night = { openingStock: 80, productionIn: 5, fulfillmentOut: 20, shift: "NIGHT" };
    expect(combineSplitRows(morning, night, KEYS)).toMatchObject({ openingStock: 100, productionIn: 15, fulfillmentOut: 50, shift: "NIGHT" });
  });

  it("works with only one of the two sheets saved", () => {
    expect(combineSplitRows({ openingStock: 7, productionIn: 3, fulfillmentOut: 1 }, undefined, KEYS)).toMatchObject({ openingStock: 7, productionIn: 3 });
    expect(combineSplitRows(undefined, { openingStock: 9, productionIn: 4, fulfillmentOut: 2 }, KEYS)).toMatchObject({ openingStock: 9, fulfillmentOut: 2 });
  });

  it("is null when neither sheet has a row, and rounds to 2dp", () => {
    expect(combineSplitRows(undefined, undefined, KEYS)).toBeNull();
    const r = combineSplitRows({ openingStock: 0, productionIn: 0.1, fulfillmentOut: 0 }, { openingStock: 0, productionIn: 0.2, fulfillmentOut: 0 }, KEYS);
    expect(r?.productionIn).toBe(0.3);
  });
});
