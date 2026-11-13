import { describe, expect, it } from "vitest";
import { entryProgress, nextBlank } from "./entryProgress";

const row = (id: number, category: string, isSaved = false) => ({ product: { id, category }, isSaved });

describe("entryProgress", () => {
  const rows = [row(1, "Sauces", true), row(2, "Sauces"), row(3, "Drinks"), row(4, "Sauces"), row(5, "Drinks", true)];

  it("counts saved rows and rows with a staged edit as entered", () => {
    const p = entryProgress(rows, { 3: { productionIn: 0 } });
    expect(p.total).toBe(5);
    expect(p.done).toBe(3);
    expect(p.blank).toEqual([2, 4]);
  });

  it("orders ids the way the grid groups them (by category, first appearance)", () => {
    expect(entryProgress(rows, {}).order).toEqual([1, 2, 4, 3, 5]);
  });

  it("treats an emptied pending entry as not entered", () => {
    expect(entryProgress([row(1, "A")], { 1: {} }).blank).toEqual([1]);
  });

  it("handles no rows", () => {
    expect(entryProgress(null, {})).toEqual({ total: 0, done: 0, order: [], blank: [] });
  });
});

describe("nextBlank", () => {
  const p = entryProgress([row(1, "A"), row(2, "A", true), row(3, "A"), row(4, "B", true), row(5, "B")], {});

  it("starts from the first blank when nothing is focused", () => {
    expect(nextBlank(p, null)).toBe(1);
  });

  it("moves forward past entered rows", () => {
    expect(nextBlank(p, 1)).toBe(3);
    expect(nextBlank(p, 3)).toBe(5);
  });

  it("wraps to the top after the last blank", () => {
    expect(nextBlank(p, 5)).toBe(1);
  });

  it("starts from the first blank when the focused product is not on the sheet", () => {
    expect(nextBlank(p, 99)).toBe(1);
  });

  it("is null when everything is entered", () => {
    expect(nextBlank(entryProgress([row(1, "A", true)], {}), null)).toBeNull();
  });
});
