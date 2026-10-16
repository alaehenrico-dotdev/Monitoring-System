// @vitest-environment node
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { templateRowsFromColumn } from "./orderTemplate";
import { planProductSync } from "./productSync";
import { readXlsxColumnA, type XlsxStyledCell } from "./xlsx";

const cell = (row: number, text: string, bold: boolean, size: number): XlsxStyledCell => ({ row, text, bold, size });

describe("templateRowsFromColumn", () => {
  it("reads big bold text as a category and plain-size bold text as its products", () => {
    const rows = templateRowsFromColumn([
      cell(1, "46303", true, 20), // the sheet's date
      cell(2, "SKU'S", true, 20), // a title with no product under it
      cell(5, "CLASS A (LITER)", true, 16),
      cell(6, "SWEET A", true, 11),
      cell(7, "SPECIAL A", true, 11),
      cell(8, "PREMIUM (LITER)", true, 16),
      cell(9, "SPECIAL", true, 11),
      cell(12, "VARIANCE:36", false, 11), // not bold: ignored
      cell(13, "a note", false, 16),
    ]);
    expect(rows).toEqual([
      { category: "CLASS A (LITER)", name: "SWEET A" },
      { category: "CLASS A (LITER)", name: "SPECIAL A" },
      { category: "PREMIUM (LITER)", name: "SPECIAL" },
    ]);
  });

  it("keeps the same name in two categories, and drops an exact repeat", () => {
    const rows = templateRowsFromColumn([
      cell(1, "A", true, 16), cell(2, "SPECIAL", true, 11), cell(3, "special", true, 11),
      cell(4, "B", true, 16), cell(5, "SPECIAL", true, 11),
    ]);
    expect(rows.map((r) => `${r.category}/${r.name}`)).toEqual(["A/SPECIAL", "B/SPECIAL"]);
  });
});

const REAL = resolve(__dirname, "../../../encoder product and category default order.xlsx");

describe.skipIf(!existsSync(REAL))("the real encoder order workbook", () => {
  it("reads its categories and products from the bold formatting", async () => {
    const b = readFileSync(REAL);
    const sheets = await readXlsxColumnA(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer);
    const rows = templateRowsFromColumn(sheets[0].cells);
    const categories = [...new Set(rows.map((r) => r.category))];
    expect(categories).toEqual([
      "PREMIUM (350 ML)",
      "CLASS A -(LITER)",
      "PREMIUM (LITER)",
      "CLASS A (GALLON)",
      "PREMIUM ( 3.785 LITERS P.E.T)",
      "Other PRODUCTS",
    ]);
    expect(rows[0]).toEqual({ category: "PREMIUM (350 ML)", name: "SPECIAL" });
    expect(rows.at(-1)).toEqual({ category: "Other PRODUCTS", name: "NSC TOYOMANSI" });
    // The date, "SKU'S" title and the "VARIANCE:36" footer are not products.
    expect(rows.some((r) => /SKU|VARIANCE|^\d+$/.test(r.name))).toBe(false);
    expect(rows.filter((r) => r.category === "Other PRODUCTS")).toHaveLength(8);
    expect(rows).toHaveLength(56);
  });

  it("syncs a product list to all 56 products in 6 categories, in the template's order", async () => {
    const b = readFileSync(REAL);
    const sheets = await readXlsxColumnA(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer);
    const rows = templateRowsFromColumn(sheets[0].cells);
    // Against an empty system every row is a product to add, in the sheet's order.
    const plan = planProductSync(rows, []);
    expect(plan.items.map((i) => `${i.category}/${i.name}`)).toEqual(rows.map((r) => `${r.category}/${r.name}`));
    expect(plan.toCreate).toHaveLength(56);
    expect(new Set(plan.items.map((i) => i.category)).size).toBe(6);
  });
});
