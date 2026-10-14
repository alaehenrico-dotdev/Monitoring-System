import { describe, expect, it } from "vitest";
import { splitCombinedSheet } from "./combinedSheet";

const combined = [
  ["ONLINE STOCK MONITORING - 2026-10-14", ""],
  ["PRODUCTS", "STOCKS", "MANUAL COUNTING"],
  ["Sweet A", "5", "4"],
  ["", "", ""],
  ["OFFLINE STOCK MONITORING - 2026-10-14", ""],
  ["PRODUCTS", "STOCKS", "MANUAL COUNTING"],
  ["Sweet A", "9", "9"],
  ["Toyo Mansi", "2", "1"],
];

describe("splitCombinedSheet", () => {
  it("passes a plain single-table file through untouched", () => {
    const plain = [["PRODUCTS", "STOCKS"], ["Sweet A", "5"]];
    const out = splitCombinedSheet(plain, "ONLINE");
    expect(out.combined).toBe(false);
    expect(out.table).toBe(plain);
  });

  it("keeps only the Online section for ONLINE", () => {
    const out = splitCombinedSheet(combined, "ONLINE");
    expect(out.combined).toBe(true);
    expect(out.sectionsFound).toEqual(["ONLINE", "OFFLINE"]);
    expect(out.table.map((r) => r[0])).toEqual(["PRODUCTS", "Sweet A", ""]);
    expect(out.skippedRows).toBe(3); // Offline's header + 2 products
  });

  it("keeps only the Offline section for OFFLINE", () => {
    const out = splitCombinedSheet(combined, "OFFLINE");
    expect(out.table.map((r) => r[0])).toEqual(["PRODUCTS", "Sweet A", "Toyo Mansi"]);
    expect(out.skippedRows).toBe(2);
  });

  it("returns no rows when the file lacks the chosen section", () => {
    const onlyOnline = combined.slice(0, 4);
    const out = splitCombinedSheet(onlyOnline, "OFFLINE");
    expect(out.combined).toBe(true);
    expect(out.sectionsFound).toEqual(["ONLINE"]);
    expect(out.table).toEqual([]);
  });

  it("does not mistake a column-header row for a section title", () => {
    const plain = [["ONLINE STOCKS", "PRODUCTS"], ["x", "Sweet A"]];
    expect(splitCombinedSheet(plain, "ONLINE").combined).toBe(false);
  });

  it("keeps a single header when a location has two sections", () => {
    const twice = [...combined, ["ONLINE STOCK MONITORING (cont.)"], ["PRODUCTS", "STOCKS"], ["Toyo Mansi", "1"]];
    const out = splitCombinedSheet(twice, "ONLINE");
    expect(out.table.filter((r) => r[0] === "PRODUCTS")).toHaveLength(1);
    expect(out.table.map((r) => r[0])).toContain("Toyo Mansi");
  });
});
