import { describe, expect, it } from "vitest";
import { endOfDayIso, recordLabel, shortDate, startOfDayIso } from "./changeLogLabel";

const NOW = new Date(2026, 9, 9);

describe("recordLabel", () => {
  it("reads like the grid row it points at", () => {
    expect(
      recordLabel(
        { productId: 5, sku: "AFP007", productName: "Soy Sauce 1L", entryDate: "2026-10-09", shift: "NIGHT", location: "ONLINE" },
        4821,
        NOW,
      ),
    ).toBe("AFP007 · Soy Sauce 1L · Oct 9 · Night · Online");
  });

  it("leaves out what a SKU row does not have", () => {
    expect(recordLabel({ productId: 5, sku: "AFP007", productName: "Soy Sauce 1L", entryDate: null, shift: null, location: null }, 5, NOW)).toBe(
      "AFP007 · Soy Sauce 1L",
    );
  });

  it("skips a missing SKU rather than printing null", () => {
    expect(recordLabel({ productId: 5, sku: null, productName: "Vinegar", entryDate: "2026-10-09", shift: "MORNING", location: "OFFLINE" }, 1, NOW)).toBe(
      "Vinegar · Oct 9 · Morning · Offline",
    );
  });

  it("falls back to the id when nothing else is known", () => {
    expect(recordLabel(null, 4821, NOW)).toBe("#4821");
    expect(recordLabel({ productId: null, sku: null, productName: null, entryDate: null, shift: null, location: null }, 7, NOW)).toBe("#7");
  });
});

describe("shortDate", () => {
  it("adds the year only when it is not the current one", () => {
    expect(shortDate("2026-10-09", NOW)).toBe("Oct 9");
    expect(shortDate("2025-12-31", NOW)).toBe("Dec 31, 2025");
  });
});

describe("day bounds", () => {
  it("spans the whole local day", () => {
    const from = new Date(startOfDayIso("2026-10-09")!);
    const to = new Date(endOfDayIso("2026-10-09")!);
    expect([from.getHours(), from.getMinutes(), from.getDate()]).toEqual([0, 0, 9]);
    expect([to.getHours(), to.getMinutes(), to.getDate()]).toEqual([23, 59, 9]);
  });

  it("returns nothing for a malformed date", () => {
    expect(startOfDayIso("")).toBeUndefined();
    expect(endOfDayIso("nope")).toBeUndefined();
  });
});
