import { describe, expect, it } from "vitest";
import { matchesSearch } from "./search";

describe("matchesSearch", () => {
  it("matches everything on an empty/whitespace-only query", () => {
    expect(matchesSearch(["Sweet A"], "")).toBe(true);
    expect(matchesSearch(["Sweet A"], "   ")).toBe(true);
  });

  it("matches a single term case-insensitively", () => {
    expect(matchesSearch(["Sweet A"], "sweet")).toBe(true);
    expect(matchesSearch(["Sweet A"], "SWEET")).toBe(true);
    expect(matchesSearch(["Sweet A"], "sour")).toBe(false);
  });

  it("requires every space-separated term to appear, in any order, across fields", () => {
    // "gallon sweet" reversed, and split across two different fields.
    expect(matchesSearch(["Sweet A", "Class A (Gallon)"], "gallon sweet")).toBe(true);
  });

  it("fails if even one term is missing from every field", () => {
    expect(matchesSearch(["Sweet A", "Class A (Gallon)"], "gallon sour")).toBe(false);
  });

  it("ignores null/undefined fields instead of throwing", () => {
    expect(matchesSearch([null, undefined, "Sweet A"], "sweet")).toBe(true);
  });

  it("matches a numeric field (e.g. a record id) as a substring", () => {
    expect(matchesSearch([1042, "Toyo Mansi"], "104")).toBe(true);
  });
});
