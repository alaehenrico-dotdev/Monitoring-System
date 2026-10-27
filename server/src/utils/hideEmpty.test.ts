import { describe, expect, it } from "vitest";
import { describeHidden, hideEmpty, SHOW_ALL } from "./hideEmpty";
import type { PdfTable } from "./tablesPdf";

// Category, SKU, Product, then four figure columns.
const table = (): PdfTable => ({
  name: "Offline",
  columns: ["Category", "SKU", "Product", "Opening", "Delivery", "Backloads", "Remaining"],
  rows: [
    ["Class A", "A1", "Alpha", 10, 4, 0, 6], // has figures
    ["Class A", "A2", "Beta", 0, 0, 0, 0], // empty row
    ["Class B", "B1", "Gamma", 5, 0, 0, 5], // stock only: NOT empty
    ["Class B", "B2", "Delta", null, null, null, 0], // empty row (blanks and zero)
  ],
});
const on = { hideEmptyRows: true, hideEmptyColumns: true };

describe("hideEmpty", () => {
  it("changes nothing when both options are off", () => {
    const t = table();
    const r = hideEmpty(t, 3, SHOW_ALL);
    expect(r.table).toEqual(t);
    expect(r.hiddenRows).toBe(0);
    expect(r.hiddenColumns).toEqual([]);
  });

  it("hides a row only when every figure in it is zero or blank", () => {
    const r = hideEmpty(table(), 3, { hideEmptyRows: true, hideEmptyColumns: false });
    expect(r.table.rows.map((x) => x[2])).toEqual(["Alpha", "Gamma"]);
    expect(r.hiddenRows).toBe(2);
    expect(r.table.columns).toHaveLength(7); // columns untouched
  });

  it("keeps a product that only has stock, no movement", () => {
    const r = hideEmpty(table(), 3, { hideEmptyRows: true, hideEmptyColumns: false });
    expect(r.table.rows.some((x) => x[2] === "Gamma")).toBe(true);
  });

  it("hides a column only when it is zero for every product", () => {
    const r = hideEmpty(table(), 3, { hideEmptyRows: false, hideEmptyColumns: true });
    expect(r.hiddenColumns).toEqual(["Backloads"]);
    expect(r.table.columns).toEqual(["Category", "SKU", "Product", "Opening", "Delivery", "Remaining"]);
    expect(r.table.rows.every((x) => x.length === r.table.columns.length)).toBe(true); // rows stay aligned with headers
    expect(r.table.rows[0]).toEqual(["Class A", "A1", "Alpha", 10, 4, 6]);
  });

  it("does both, and the figures that remain are exactly the original ones", () => {
    const r = hideEmpty(table(), 3, on);
    expect(r.table.rows).toEqual([
      ["Class A", "A1", "Alpha", 10, 4, 6],
      ["Class B", "B1", "Gamma", 5, 0, 5],
    ]);
  });

  it("never changes a column total: everything hidden was zero", () => {
    const sum = (t: PdfTable, label: string) => {
      const i = t.columns.indexOf(label);
      return t.rows.reduce((a, r) => a + (typeof r[i] === "number" ? (r[i] as number) : 0), 0);
    };
    const before = table();
    const after = hideEmpty(before, 3, on).table;
    for (const label of ["Opening", "Delivery", "Remaining"]) expect(sum(after, label)).toBe(sum(before, label));
  });

  it("never hides the label columns (Category, SKU, Product), even though they are text", () => {
    expect(hideEmpty(table(), 3, on).table.columns.slice(0, 3)).toEqual(["Category", "SKU", "Product"]);
  });

  it("keeps the columns when every figure column would be hidden", () => {
    const blank: PdfTable = { name: "X", columns: ["SKU", "Product", "A", "B"], rows: [["a", "Alpha", 0, 0], ["b", "Beta", 0, 0]] };
    const r = hideEmpty(blank, 2, { hideEmptyRows: false, hideEmptyColumns: true });
    expect(r.table.columns).toEqual(["SKU", "Product", "A", "B"]);
    expect(r.hiddenColumns).toEqual([]);
  });

  it("a day with nothing at all gives an empty table, not an error", () => {
    const blank: PdfTable = { name: "X", columns: ["SKU", "Product", "A"], rows: [["a", "Alpha", 0], ["b", "Beta", null]] };
    const r = hideEmpty(blank, 2, { hideEmptyRows: true, hideEmptyColumns: true });
    expect(r.table.rows).toEqual([]);
    expect(r.hiddenRows).toBe(2);
  });

  it("leaves a table with no rows alone", () => {
    const none: PdfTable = { name: "X", columns: ["SKU", "Product", "A"], rows: [] };
    expect(hideEmpty(none, 2, on).table).toEqual(none);
  });

  it("does not modify the table it was given", () => {
    const t = table();
    hideEmpty(t, 3, on);
    expect(t).toEqual(table());
  });
});

describe("describeHidden", () => {
  it("says what was left out, sheet by sheet", () => {
    expect(
      describeHidden([
        { name: "Online", hiddenRows: 13, hiddenColumns: ["RTS"] },
        { name: "Offline", hiddenRows: 8, hiddenColumns: ["Backloads", "GERALD"] },
        { name: "Consolidated", hiddenRows: 0, hiddenColumns: [] },
      ]),
    ).toEqual({ rows: "Online 13, Offline 8", columns: "Online: RTS; Offline: Backloads, GERALD" });
  });

  it("is null for both when nothing was hidden", () => {
    expect(describeHidden([{ name: "Online", hiddenRows: 0, hiddenColumns: [] }])).toEqual({ rows: null, columns: null });
  });
});
