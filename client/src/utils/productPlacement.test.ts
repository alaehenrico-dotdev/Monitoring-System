import { describe, expect, it } from "vitest";
import { categoriesOf, insertAfterCategory, unitForCategory } from "./productPlacement";

const p = (name: string, category: string, unit = "Liter") => ({ name, category, unit });

describe("insertAfterCategory", () => {
  const list = [p("A", "Class A"), p("B", "Class A"), p("C", "Oils"), p("D", "Other")];

  it("goes right after the last product of its category", () => {
    expect(insertAfterCategory(list, p("X", "Class A")).map((x) => x.name)).toEqual(["A", "B", "X", "C", "D"]);
    expect(insertAfterCategory(list, p("X", "Oils")).map((x) => x.name)).toEqual(["A", "B", "C", "X", "D"]);
  });

  it("matches the category the way a person reads it", () => {
    expect(insertAfterCategory(list, p("X", "  class   a ")).map((x) => x.name)).toEqual(["A", "B", "X", "C", "D"]);
  });

  it("goes to the end for a new category, and does not change the list it was given", () => {
    expect(insertAfterCategory(list, p("X", "Brand new")).map((x) => x.name)).toEqual(["A", "B", "C", "D", "X"]);
    expect(list).toHaveLength(4);
    expect(insertAfterCategory([], p("X", "Any"))).toHaveLength(1);
  });
});

describe("categoriesOf / unitForCategory", () => {
  it("lists each category once, in order of first appearance", () => {
    expect(categoriesOf([p("A", "Class A"), p("B", "Oils"), p("C", "class a"), p("D", "Oils")])).toEqual(["Class A", "Oils"]);
  });

  it("reads the unit the category already uses, or nothing for a new one", () => {
    const list = [p("A", "Class A", "Liter"), p("B", "Class A (Gallon)", "Gallon")];
    expect(unitForCategory(list, "class a (gallon)")).toBe("Gallon");
    expect(unitForCategory(list, "Nope")).toBe("");
  });
});
