import { describe, expect, it, vi } from "vitest";
import { fitWidthItem } from "./fitWidthMenu";

describe("fitWidthItem", () => {
  it("offers to fit a compact table, and to compact a fitted one", () => {
    expect(fitWidthItem(false, vi.fn()).label).toBe("Fit table to width");
    expect(fitWidthItem(true, vi.fn()).label).toBe("Compact table width");
  });

  it("flips the setting when chosen", () => {
    const onChange = vi.fn();
    fitWidthItem(false, onChange).onSelect?.(null);
    expect(onChange).toHaveBeenLastCalledWith(true);
    fitWidthItem(true, onChange).onSelect?.(null);
    expect(onChange).toHaveBeenLastCalledWith(false);
  });

  it("is always available - it needs no data to take effect", () => {
    expect(fitWidthItem(false, vi.fn()).disabledReason).toBeUndefined();
  });
});
