import { describe, expect, it } from "vitest";
import { moveItem } from "../utils/moveItem";

describe("moveItem", () => {
  it("moves an item down and up, shifting the rows between", () => {
    expect(moveItem([1, 2, 3, 4], 0, 2)).toEqual([2, 3, 1, 4]);
    expect(moveItem([1, 2, 3, 4], 3, 1)).toEqual([1, 4, 2, 3]);
  });

  it("returns the list untouched for a no-op or out-of-range move", () => {
    const list = [1, 2, 3];
    expect(moveItem(list, 1, 1)).toBe(list);
    expect(moveItem(list, 0, -1)).toBe(list);
    expect(moveItem(list, 0, 3)).toBe(list);
  });
});
