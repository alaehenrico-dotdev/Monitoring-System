import { describe, expect, it } from "vitest";
import { planProductSync, sheetRowKey, type ExistingProduct } from "./productSync";

const ex = (id: number, name: string, category: string, sortOrder: number, sku: string | null = null): ExistingProduct => ({
  id,
  name,
  category,
  sortOrder,
  sku,
});

describe("planProductSync", () => {
  const existing = [ex(1, "Sweet A", "Class A (Liter)", 1, "AFP007"), ex(2, "Special A", "Class A (Liter)", 2, "AFP008")];

  it("is in sync when names, categories and order already match (looser category spelling is fine)", () => {
    const plan = planProductSync(
      [
        { category: "CLASS A -(LITER)", name: "SWEET A" },
        { category: "CLASS A -(LITER)", name: "SPECIAL A" },
      ],
      existing,
    );
    expect(plan.inSync).toBe(true);
    expect(plan.items.map((i) => i.productId)).toEqual([1, 2]);
  });

  it("adds a product that is not strictly in the system, in the sheet's category spelling of the system", () => {
    const plan = planProductSync(
      [
        { category: "CLASS A -(LITER)", name: "SWEET A" },
        { category: "CLASS A -(LITER)", name: "BRAND NEW" },
        { category: "CLASS A -(LITER)", name: "SPECIAL A" },
      ],
      existing,
    );
    expect(plan.toCreate.map((c) => [c.category, c.name])).toEqual([["Class A (Liter)", "BRAND NEW"]]);
    expect(plan.items.map((i) => i.productId)).toEqual([1, undefined, 2]);
    expect(plan.reordered).toBe(1); // Special A moves from 2 to 3
    expect(plan.inSync).toBe(false);
  });

  it("treats a near miss as new but offers the existing product as a suggestion - never auto-matched", () => {
    const plan = planProductSync(
      [{ category: "Premium", name: "JAMPONG CHILI HOT SAUCE" }],
      [ex(5, "Jampong Hot Chili Sauce", "Premium", 1, "AFP056")],
    );
    expect(plan.toCreate).toHaveLength(1);
    expect(plan.toCreate[0].suggestions[0]?.sku).toBe("AFP056");
    expect(plan.items[0].productId).toBeUndefined();
  });

  it("a link renames the existing product instead of adding a duplicate", () => {
    const sheet = [{ category: "Premium", name: "JAMPONG CHILI HOT SAUCE" }];
    const products = [ex(5, "Jampong Hot Chili Sauce", "Premium", 1, "AFP056")];
    const plan = planProductSync(sheet, products, { [sheetRowKey("Premium", "JAMPONG CHILI HOT SAUCE")]: 5 });
    expect(plan.toCreate).toHaveLength(0);
    expect(plan.toRename).toEqual([expect.objectContaining({ from: "Jampong Hot Chili Sauce", to: "JAMPONG CHILI HOT SAUCE" })]);
    expect(plan.items[0]).toMatchObject({ productId: 5, rename: true });
  });

  it("moves a uniquely-named product that sits under another category instead of duplicating it", () => {
    const plan = planProductSync([{ category: "Other PRODUCTS", name: "CASSAVA" }], [ex(9, "Cassava", "New Products", 1)]);
    expect(plan.toMove).toEqual([{ name: "Cassava", from: "New Products", to: "Other PRODUCTS" }]);
    expect(plan.toCreate).toHaveLength(0);
  });

  it("keeps same-named products in different categories apart", () => {
    const products = [ex(1, "Special", "Premium (350ML)", 1), ex(2, "Special", "Premium (Liter)", 2)];
    const plan = planProductSync(
      [
        { category: "PREMIUM (LITER)", name: "SPECIAL" },
        { category: "PREMIUM (350 ML)", name: "SPECIAL" },
      ],
      products,
    );
    expect(plan.items.map((i) => i.productId)).toEqual([2, 1]);
    expect(plan.toMove).toHaveLength(0);
    expect(plan.reordered).toBe(2);
  });

  it("puts products the sheet does not mention after the sheet's, and collapses a repeated row", () => {
    const plan = planProductSync(
      [
        { category: "Class A (Liter)", name: "Special A" },
        { category: "Class A (Liter)", name: "special   a" },
      ],
      existing,
    );
    expect(plan.items).toHaveLength(1);
    expect(plan.reordered).toBe(2); // Special A -> 1, Sweet A -> 2
  });
});
