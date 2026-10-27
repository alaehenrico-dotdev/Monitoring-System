import { describe, expect, it } from "vitest";
import { describeHiddenOnPage, viewStockSheet, viewTotalRows } from "./hideEmptyReport";

const p = (name: string, category = "Class A") => ({ name, category });
const columns = [
  { key: "openingStock", label: "Opening" },
  { key: "deliveryOut", label: "Delivery" },
  { key: "backloads", label: "Backloads" },
  { key: "remainingStock", label: "Remaining" },
];
// Delivery has two added columns: slot 1 is used, slot 2 never is.
const extras = { deliveryOut: [1, 2] };
const rows = [
  { product: p("Alpha"), entry: { openingStock: 10, deliveryOut: 4, deliveryOut__x1: 4, deliveryOut__x2: 0, backloads: 0, remainingStock: 6 } },
  { product: p("Beta"), entry: { openingStock: 0, deliveryOut: 0, deliveryOut__x1: 0, deliveryOut__x2: 0, backloads: 0, remainingStock: 0 } }, // empty
  { product: p("Gamma", "Class B"), entry: { openingStock: 5, deliveryOut: 0, deliveryOut__x1: 0, deliveryOut__x2: 0, backloads: 0, remainingStock: 5 } }, // stock only
];
const off = { rows: false, columns: false };

describe("viewStockSheet", () => {
  it("shows everything when both switches are off", () => {
    const v = viewStockSheet(rows, columns, extras, off);
    expect(v.rows).toBe(rows);
    expect(v.columns).toBe(columns);
    expect(v.extras).toBe(extras);
    expect([v.hiddenRows, v.hiddenColumns]).toEqual([0, 0]);
  });

  it("hides a row only when every figure in it, added columns included, is zero", () => {
    const v = viewStockSheet(rows, columns, extras, { rows: true, columns: false });
    expect(v.rows.map((r) => r.product.name)).toEqual(["Alpha", "Gamma"]); // Gamma has stock only: kept
    expect(v.hiddenRows).toBe(1);
    expect(v.columns).toBe(columns);
  });

  it("hides a column only when it is zero for every product, and an unused added column goes on its own", () => {
    const v = viewStockSheet(rows, columns, extras, { rows: false, columns: true });
    expect(v.columns.map((c) => c.key)).toEqual(["openingStock", "deliveryOut", "remainingStock"]); // Backloads gone
    expect(v.extras).toEqual({ deliveryOut: [1] }); // slot 2 gone, slot 1 stays
    expect(v.hiddenColumns).toBe(2); // Backloads and Delivery's second added column
    expect(v.rows).toHaveLength(3);
  });

  it("does both at once", () => {
    const v = viewStockSheet(rows, columns, extras, { rows: true, columns: true });
    expect(v.rows.map((r) => r.product.name)).toEqual(["Alpha", "Gamma"]);
    expect(v.columns.map((c) => c.key)).toEqual(["openingStock", "deliveryOut", "remainingStock"]);
  });

  it("never loses a figure: whatever is hidden was zero everywhere", () => {
    const v = viewStockSheet(rows, columns, extras, { rows: true, columns: true });
    const shownKeys = new Set(v.columns.flatMap((c) => [c.key, ...(v.extras[c.key] ?? []).map((s) => `${c.key}__x${s}`)]));
    const all = Object.keys(rows[0].entry);
    for (const key of all) {
      if (!shownKeys.has(key)) expect(rows.every((r) => !(r.entry as Record<string, number>)[key]), key).toBe(true);
    }
    const sum = (list: typeof rows, key: string) => list.reduce((a, r) => a + ((r.entry as Record<string, number>)[key] ?? 0), 0);
    for (const c of v.columns) expect(sum(v.rows, c.key), c.key).toBe(sum(rows, c.key));
  });

  it("narrows to a category first, then judges emptiness within it", () => {
    // Within Class B only Gamma exists: Delivery is zero for all of it, so it goes.
    const v = viewStockSheet(rows, columns, extras, { rows: true, columns: true }, "Class B");
    expect(v.rows.map((r) => r.product.name)).toEqual(["Gamma"]);
    expect(v.columns.map((c) => c.key)).toEqual(["openingStock", "remainingStock"]);
  });

  it("keeps the columns when every one of them would be hidden", () => {
    const blank = [{ product: p("Zed"), entry: { openingStock: 0, deliveryOut: 0, backloads: 0, remainingStock: 0 } }];
    const v = viewStockSheet(blank, columns, {}, { rows: false, columns: true });
    expect(v.columns).toBe(columns);
    expect(v.hiddenColumns).toBe(0);
  });

  it("treats blanks, null and text zeros as empty, and any real number as a figure", () => {
    const odd = [
      { product: p("A"), entry: { openingStock: null, deliveryOut: "", backloads: "0", remainingStock: undefined } },
      { product: p("B"), entry: { openingStock: "7", deliveryOut: null, backloads: null, remainingStock: 7 } },
    ];
    const v = viewStockSheet(odd, columns, {}, { rows: true, columns: false });
    expect(v.rows.map((r) => r.product.name)).toEqual(["B"]);
  });

  it("handles a day with no rows", () => {
    expect(viewStockSheet([], columns, extras, { rows: true, columns: true }).rows).toEqual([]);
  });
});

describe("viewTotalRows", () => {
  const totals = [
    { product: p("Alpha"), onlineRemainingStock: 6, offlineRemainingStock: 0, totalRemainingStock: 6, totalManualCount: null, totalVariance: null },
    { product: p("Beta"), onlineRemainingStock: 0, offlineRemainingStock: 0, totalRemainingStock: 0, totalManualCount: null, totalVariance: null },
    { product: p("Gamma", "Class B"), onlineRemainingStock: 0, offlineRemainingStock: 0, totalRemainingStock: 0, totalManualCount: 3, totalVariance: -3 }, // counted: keep
  ];

  it("leaves rows alone when off", () => {
    expect(viewTotalRows(totals, off).rows).toBe(totals);
  });

  it("hides a product with nothing in any column, but keeps one that was counted", () => {
    const v = viewTotalRows(totals, { rows: true, columns: false });
    expect(v.rows.map((r) => r.product.name)).toEqual(["Alpha", "Gamma"]);
    expect(v.hiddenRows).toBe(1);
  });

  it("narrows to a category", () => {
    expect(viewTotalRows(totals, { rows: true, columns: false }, "Class A").rows.map((r) => r.product.name)).toEqual(["Alpha"]);
  });
});

describe("describeHiddenOnPage", () => {
  it("says what is not shown", () => {
    expect(describeHiddenOnPage({ rows: 13, columns: 2 })).toBe("Not shown: 13 products with no figures and 2 empty columns.");
    expect(describeHiddenOnPage({ rows: 1, columns: 0 })).toBe("Not shown: 1 product with no figures.");
    expect(describeHiddenOnPage({ rows: 0, columns: 1 })).toBe("Not shown: 1 empty column.");
  });

  it("is null when nothing is hidden", () => {
    expect(describeHiddenOnPage({ rows: 0, columns: 0 })).toBeNull();
  });
});
