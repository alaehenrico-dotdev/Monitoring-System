import { describe, expect, it } from "vitest";
import { planCountPaste } from "./manualCountPaste";

const rows = [
  { productId: 1, name: "Soy Sauce" },
  { productId: 2, name: "Vinegar" },
  { productId: 3, name: "Fish Sauce" },
];
const none = () => undefined;

describe("planCountPaste", () => {
  it("leaves a single cell to the browser", () => {
    expect(planCountPaste("12", { loc: "OFFLINE", productId: 1 }, rows, ["OFFLINE", "ONLINE"], none)).toBeNull();
    expect(planCountPaste("", { loc: "OFFLINE", productId: 1 }, rows, ["OFFLINE", "ONLINE"], none)).toBeNull();
  });

  it("flows right across Offline then Online and down the rows", () => {
    const out = planCountPaste("1\t2\n3\t4", { loc: "OFFLINE", productId: 1 }, rows, ["OFFLINE", "ONLINE"], none)!;
    expect(out.edits).toEqual([
      { loc: "OFFLINE", productId: 1, value: 1 },
      { loc: "ONLINE", productId: 1, value: 2 },
      { loc: "OFFLINE", productId: 2, value: 3 },
      { loc: "ONLINE", productId: 2, value: 4 },
    ]);
    expect(out.variant).toBe("success");
    expect(out.message).toBe("Pasted 4 cells");
  });

  it("stays in the one visible location column", () => {
    const out = planCountPaste("5\n6", { loc: "ONLINE", productId: 2 }, rows, ["ONLINE"], none)!;
    expect(out.edits).toEqual([
      { loc: "ONLINE", productId: 2, value: 5 },
      { loc: "ONLINE", productId: 3, value: 6 },
    ]);
  });

  it("skips bad cells one by one, leaves blanks alone and explains why", () => {
    const out = planCountPaste("7\tabc\n\t-2", { loc: "OFFLINE", productId: 1 }, rows, ["OFFLINE", "ONLINE"], none)!;
    expect(out.edits).toEqual([{ loc: "OFFLINE", productId: 1, value: 7 }]);
    expect(out.message).toBe("Pasted 1 cell, skipped 2");
    expect(out.detail).toContain("not a number");
    expect(out.detail).toContain("negative value");
  });

  it("does not count a value that matches what is already there", () => {
    const out = planCountPaste("1\t9", { loc: "OFFLINE", productId: 1 }, rows, ["OFFLINE", "ONLINE"], (loc) => (loc === "OFFLINE" ? 1 : undefined))!;
    expect(out.edits).toEqual([{ loc: "ONLINE", productId: 1, value: 9 }]);
  });

  it("reports cells past the end of the sheet", () => {
    const out = planCountPaste("1\n2\n3\n4", { loc: "OFFLINE", productId: 2 }, rows, ["OFFLINE"], none)!;
    expect(out.edits).toHaveLength(2);
    expect(out.detail).toContain("past the end of the grid");
  });

  it("refuses an oversized block outright", () => {
    const big = Array.from({ length: 600 }, () => "1").join("\n");
    const out = planCountPaste(big, { loc: "OFFLINE", productId: 1 }, rows, ["OFFLINE"], none)!;
    expect(out.edits).toEqual([]);
    expect(out.variant).toBe("error");
  });
});
