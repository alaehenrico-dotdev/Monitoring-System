import { describe, expect, it } from "vitest";
import {
  copyableColumns,
  defaultCopyKeys,
  describePeriod,
  planCopyPrevious,
  previousPeriod,
  type CopyRow,
} from "./copyPrevious";
import { offlineStockColumns, onlineStockColumns } from "../config/stockColumns";

describe("previousPeriod", () => {
  it("walks Night back to the same date's Morning", () => {
    expect(previousPeriod({ date: "2026-10-09", shift: "NIGHT" }, "previous-shift")).toEqual({
      date: "2026-10-09",
      shift: "MORNING",
    });
  });

  it("walks Morning back to the previous date's Night", () => {
    expect(previousPeriod({ date: "2026-10-09", shift: "MORNING" }, "previous-shift")).toEqual({
      date: "2026-10-08",
      shift: "NIGHT",
    });
  });

  it("holds the shift and steps the date back for 'previous day'", () => {
    expect(previousPeriod({ date: "2026-10-09", shift: "NIGHT" }, "previous-day")).toEqual({
      date: "2026-10-08",
      shift: "NIGHT",
    });
  });

  it("crosses a month boundary", () => {
    expect(previousPeriod({ date: "2026-11-01", shift: "MORNING" }, "previous-day").date).toBe("2026-10-31");
  });

  it("crosses a leap day", () => {
    expect(previousPeriod({ date: "2028-03-01", shift: "NIGHT" }, "previous-day").date).toBe("2028-02-29");
  });

  it("describes a period for the toast", () => {
    expect(describePeriod({ date: "2026-10-08", shift: "NIGHT" })).toBe("2026-10-08 Night");
  });
});

describe("copyableColumns", () => {
  it("never offers a calculated column", () => {
    for (const columns of [onlineStockColumns, offlineStockColumns]) {
      const keys = copyableColumns(columns).map((c) => c.key);
      expect(keys).not.toContain("remainingStock");
      expect(keys).not.toContain("onlineStock");
      expect(keys).not.toContain("offlineStock");
    }
  });

  it("never offers Opening Stock, which the server carries forward", () => {
    for (const columns of [onlineStockColumns, offlineStockColumns]) {
      expect(copyableColumns(columns).map((c) => c.key)).not.toContain("openingStock");
    }
  });

  it("defaults to the inbound transfer and Production (In) only", () => {
    expect(defaultCopyKeys(onlineStockColumns)).toEqual(["stockInOffToOl", "productionIn"]);
    expect(defaultCopyKeys(offlineStockColumns)).toEqual(["stockInOlToOff", "productionIn"]);
  });

  it("never defaults to an out/delivery column", () => {
    expect(defaultCopyKeys(onlineStockColumns)).not.toContain("fulfillmentOut");
    expect(defaultCopyKeys(offlineStockColumns)).not.toContain("deliveryOut");
  });
});

const source: CopyRow[] = [
  { productId: 1, entry: { stockInOffToOl: 10, productionIn: 5 } },
  { productId: 2, entry: { stockInOffToOl: 20, productionIn: 0 } },
];
const target: CopyRow[] = [{ productId: 1, entry: {} }, { productId: 2, entry: {} }, { productId: 3, entry: {} }];
const KEYS = ["stockInOffToOl", "productionIn"];
const noSaved = () => 0;

describe("planCopyPrevious", () => {
  it("copies the selected columns across every product that has a source row", () => {
    const plan = planCopyPrevious(source, target, KEYS, {}, false, noSaved);
    expect(plan.edits).toEqual([
      { productId: 1, key: "stockInOffToOl", value: 10 },
      { productId: 1, key: "productionIn", value: 5 },
      { productId: 2, key: "stockInOffToOl", value: 20 },
    ]);
  });

  it("skips a product with no entry in the source period", () => {
    const plan = planCopyPrevious(source, target, KEYS, {}, false, noSaved);
    expect(plan.edits.some((e) => e.productId === 3)).toBe(false);
  });

  it("copies only the columns that were ticked", () => {
    const plan = planCopyPrevious(source, target, ["productionIn"], {}, false, noSaved);
    expect(plan.edits).toEqual([{ productId: 1, key: "productionIn", value: 5 }]);
  });

  it("leaves a cell the user already edited alone, and says how many", () => {
    const pending = { 1: { stockInOffToOl: 99 } };
    const plan = planCopyPrevious(source, target, KEYS, pending, false, noSaved);

    expect(plan.edits).toEqual([
      { productId: 1, key: "productionIn", value: 5 },
      { productId: 2, key: "stockInOffToOl", value: 20 },
    ]);
    expect(plan.protectedCells).toBe(1);
  });

  it("overwrites the user's edits when they ask for it", () => {
    const pending = { 1: { stockInOffToOl: 99 } };
    const plan = planCopyPrevious(source, target, KEYS, pending, true, noSaved);

    expect(plan.edits).toContainEqual({ productId: 1, key: "stockInOffToOl", value: 10 });
    expect(plan.protectedCells).toBe(0);
  });

  it("stages nothing for a value that already matches what is saved", () => {
    const plan = planCopyPrevious(source, target, KEYS, {}, false, (id, key) =>
      id === 1 && key === "stockInOffToOl" ? 10 : 0,
    );
    expect(plan.edits).not.toContainEqual({ productId: 1, key: "stockInOffToOl", value: 10 });
  });

  it("ignores a zero in the source rather than writing a redundant zero", () => {
    // Product 2's productionIn is 0 and the target is already 0.
    const plan = planCopyPrevious(source, target, KEYS, {}, false, noSaved);
    expect(plan.edits).not.toContainEqual({ productId: 2, key: "productionIn", value: 0 });
  });

  it("copies a real zero when the target currently holds something else", () => {
    const plan = planCopyPrevious(source, target, KEYS, {}, false, (id, key) =>
      id === 2 && key === "productionIn" ? 7 : 0,
    );
    expect(plan.edits).toContainEqual({ productId: 2, key: "productionIn", value: 0 });
  });

  it("ignores missing, blank and negative source values", () => {
    const odd: CopyRow[] = [
      { productId: 1, entry: { stockInOffToOl: null, productionIn: "" } },
      { productId: 2, entry: { stockInOffToOl: -4, productionIn: "nope" } },
    ];
    expect(planCopyPrevious(odd, target, KEYS, {}, false, noSaved).edits).toEqual([]);
  });

  it("stages nothing at all when no columns are ticked", () => {
    expect(planCopyPrevious(source, target, [], {}, false, noSaved).edits).toEqual([]);
  });
});
