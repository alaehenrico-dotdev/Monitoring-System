import { describe, expect, it } from "vitest";
import { dragTo, EMPTY_SELECTION, pressRow, rangeBetween, selectedIds, toTsv, type SelectionState } from "./rowSelection";

const V = [10, 11, 12, 13, 14, 15];
const none = { shift: false, toggle: false };
const shift = { shift: true, toggle: false };
const ctrl = { shift: false, toggle: true };
const ctrlShift = { shift: true, toggle: true };
const ids = (s: SelectionState, visible = V) => selectedIds(s, visible);

describe("rangeBetween", () => {
  it("runs either way round and includes both ends", () => {
    expect(rangeBetween(V, 11, 13)).toEqual([11, 12, 13]);
    expect(rangeBetween(V, 13, 11)).toEqual([11, 12, 13]);
  });

  it("is empty with no end, and just the end when the anchor is not visible", () => {
    expect(rangeBetween(V, 11, null)).toEqual([]);
    expect(rangeBetween(V, 99, 12)).toEqual([12]);
    expect(rangeBetween(V, 11, 99)).toEqual([]);
  });
});

describe("pressRow", () => {
  it("a plain click selects only that row, replacing the rest", () => {
    let s = pressRow(EMPTY_SELECTION, 11, none, V);
    s = pressRow(s, 13, ctrl, V);
    s = pressRow(s, 14, none, V);
    expect(ids(s)).toEqual([14]);
  });

  it("Shift+click selects the range from the anchor, and re-aiming it shrinks or moves it", () => {
    let s = pressRow(EMPTY_SELECTION, 11, none, V);
    s = pressRow(s, 14, shift, V);
    expect(ids(s)).toEqual([11, 12, 13, 14]);
    s = pressRow(s, 12, shift, V);
    expect(ids(s)).toEqual([11, 12]);
    s = pressRow(s, 10, shift, V);
    expect(ids(s)).toEqual([10, 11]);
  });

  it("Shift+click with nothing selected starts at that row", () => {
    expect(ids(pressRow(EMPTY_SELECTION, 12, shift, V))).toEqual([12]);
  });

  it("Ctrl+click adds a row, and takes a selected one back out", () => {
    let s = pressRow(EMPTY_SELECTION, 10, none, V);
    s = pressRow(s, 12, ctrl, V);
    s = pressRow(s, 14, ctrl, V);
    expect(ids(s)).toEqual([10, 12, 14]);
    s = pressRow(s, 12, ctrl, V);
    expect(ids(s)).toEqual([10, 14]);
  });

  it("Ctrl+Shift+click adds a range without losing earlier picks", () => {
    let s = pressRow(EMPTY_SELECTION, 10, none, V);
    s = pressRow(s, 12, ctrl, V);
    s = pressRow(s, 14, ctrlShift, V);
    expect(ids(s)).toEqual([10, 12, 13, 14]);
  });

  it("Shift+click after un-picking a row ranges from that row", () => {
    let s = pressRow(EMPTY_SELECTION, 10, none, V);
    s = pressRow(s, 11, ctrl, V);
    s = pressRow(s, 11, ctrl, V); // off again; the anchor is now 11
    s = pressRow(s, 13, shift, V);
    expect(ids(s)).toEqual([11, 12, 13]);
  });
});

describe("dragTo", () => {
  it("stretches the range from where the press started", () => {
    let s = pressRow(EMPTY_SELECTION, 11, none, V);
    s = dragTo(s, 13);
    expect(ids(s)).toEqual([11, 12, 13]);
    s = dragTo(s, 10);
    expect(ids(s)).toEqual([10, 11]);
  });

  it("keeps Ctrl picks while dragging a new range", () => {
    let s = pressRow(EMPTY_SELECTION, 10, none, V);
    s = pressRow(s, 13, ctrl, V);
    s = dragTo(s, 15);
    expect(ids(s)).toEqual([10, 13, 14, 15]);
  });

  it("does nothing before any press", () => {
    expect(dragTo(EMPTY_SELECTION, 12)).toBe(EMPTY_SELECTION);
  });
});

describe("selectedIds", () => {
  it("drops rows that are no longer visible and returns display order", () => {
    let s = pressRow(EMPTY_SELECTION, 14, none, V);
    s = pressRow(s, 10, ctrl, V);
    expect(ids(s)).toEqual([10, 14]);
    expect(ids(s, [10, 11, 12])).toEqual([10]);
  });
});

describe("toTsv", () => {
  it("joins with tabs and newlines, flattening anything that would break the shape", () => {
    expect(toTsv(["SKU", "Product"], [["A1", "Sweet\tA"], ["", "x\ny"]])).toBe("SKU\tProduct\nA1\tSweet A\n\tx y");
  });
});
