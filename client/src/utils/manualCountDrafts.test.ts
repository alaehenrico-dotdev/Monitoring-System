import { describe, expect, it } from "vitest";
import { draftAction, isRealChange } from "./manualCountDrafts";

describe("draftAction - setting a count", () => {
  it("sets a typed figure on a cell that had nothing", () => {
    expect(draftAction("12", null)).toEqual({ kind: "set", value: 12 });
  });

  it("sets a typed figure over an existing count", () => {
    expect(draftAction("12", 40)).toEqual({ kind: "set", value: 12 });
  });

  it("treats a counted zero as a real figure, not as empty", () => {
    // "we counted, and there are none" is a genuine audit result and must
    // reach the server as 0 rather than being mistaken for a cleared cell.
    expect(draftAction("0", null)).toEqual({ kind: "set", value: 0 });
    expect(draftAction("0", 25)).toEqual({ kind: "set", value: 0 });
  });

  it("accepts decimals, matching the Decimal(14,2) column", () => {
    expect(draftAction("12.5", null)).toEqual({ kind: "set", value: 12.5 });
  });

  it("tolerates surrounding whitespace", () => {
    expect(draftAction("  7  ", null)).toEqual({ kind: "set", value: 7 });
  });

  it("re-sends a figure equal to the saved one rather than guessing", () => {
    // The endpoint is idempotent, and suppressing this would mean a user who
    // retyped the same number saw their Save silently do nothing.
    expect(draftAction("40", 40)).toEqual({ kind: "set", value: 40 });
  });
});

describe("draftAction - clearing a count", () => {
  it("clears a cell that has a saved count", () => {
    expect(draftAction("", 40)).toEqual({ kind: "clear" });
  });

  it("clears a cell whose saved count is zero", () => {
    // A saved 0 is a real counted value, so emptying it is still a removal.
    expect(draftAction("", 0)).toEqual({ kind: "clear" });
  });

  it("treats whitespace-only as a clear", () => {
    expect(draftAction("   ", 40)).toEqual({ kind: "clear" });
  });

  it("does nothing when the cell was never counted", () => {
    expect(draftAction("", null)).toEqual({ kind: "none" });
    expect(draftAction("   ", null)).toEqual({ kind: "none" });
  });
});

describe("draftAction - bad input", () => {
  it("skips a non-numeric draft instead of failing the whole batch", () => {
    expect(draftAction("abc", 40)).toEqual({ kind: "none" });
    expect(draftAction("1,2,3", null)).toEqual({ kind: "none" });
  });

  it("skips a negative count - stock is a count of physical product", () => {
    expect(draftAction("-5", 40)).toEqual({ kind: "none" });
  });
});

describe("isRealChange", () => {
  it("agrees with draftAction, so the Save count and the dialog cannot diverge", () => {
    const cases: [string, number | null][] = [
      ["12", null],
      ["12", 40],
      ["0", null],
      ["", 40],
      ["", 0],
      ["", null],
      ["abc", 40],
      ["-5", null],
    ];
    for (const [draft, saved] of cases) {
      expect(isRealChange(draft, saved)).toBe(draftAction(draft, saved).kind !== "none");
    }
  });

  it("counts a clear as a pending change", () => {
    // The regression: the Save button counted every draft while the confirm
    // dialog filtered empty ones out, so clearing a count showed "Save (1)"
    // over a dialog that listed nothing.
    expect(isRealChange("", 40)).toBe(true);
  });

  it("does not count an emptied, never-saved cell", () => {
    expect(isRealChange("", null)).toBe(false);
  });
});
