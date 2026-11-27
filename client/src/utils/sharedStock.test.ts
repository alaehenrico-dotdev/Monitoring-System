import { describe, expect, it } from "vitest";
import { applySharedStockToGrid, rowsForColumnTotal } from "./sharedStock";

const online = (id: number, sku: string, opening: number, remaining: number, fulfillmentOut = 0, isSaved = true) => ({
  product: { id, sku },
  entry: { openingStock: opening, onlineStock: opening, productionIn: 0, fulfillmentOut, rts: 0, remainingStock: remaining },
  isSaved,
});
const offline = (id: number, sku: string, opening: number, remaining: number, deliveryOut = 0, isSaved = true) => ({
  product: { id, sku },
  entry: { openingStock: opening, offlineStock: opening, productionIn: 0, deliveryOut, backloads: 0, upsellOut: 0, remainingStock: remaining },
  isSaved,
});

describe("applySharedStockToGrid (client preview of the one palm oil stock)", () => {
  it("with nothing staged, both rows show the pool's saved remaining and nothing else changes", () => {
    const other = online(1, "AFP001", 7, 6);
    const saved = [online(52, "AFP069", 11, 7), other, online(53, "AFP070", 11, 7)];
    const result = applySharedStockToGrid(saved, saved, "ONLINE")!;
    expect(result[0].entry.remainingStock).toBe(7);
    expect(result[2].entry.remainingStock).toBe(7);
    expect(result[1]).toBe(other);
  });

  it("a staged fulfillment on one row moves the pool, and both rows show it", () => {
    const saved = [online(52, "AFP069", 11, 7), online(53, "AFP070", 11, 7)];
    // 3 typed into Gallon's Fulfillment (Out), not yet saved.
    const display = [online(52, "AFP069", 11, 7), online(53, "AFP070", 11, 7, 3, false)];
    const result = applySharedStockToGrid(display, saved, "ONLINE")!;
    expect(result.map((r) => r.entry.remainingStock)).toEqual([4, 4]);
    expect(result[1].entry.fulfillmentOut).toBe(3); // each row keeps only what was typed on it
    expect(result[0].entry.fulfillmentOut).toBe(0);
  });

  it("offline: a staged delivery moves the same pool", () => {
    const saved = [offline(52, "AFP069", 11, 7), offline(53, "AFP070", 11, 7)];
    const display = [offline(52, "AFP069", 11, 7, 2, false), offline(53, "AFP070", 11, 7)];
    const result = applySharedStockToGrid(display, saved, "OFFLINE")!;
    expect(result.map((r) => r.entry.remainingStock)).toEqual([5, 5]);
  });

  it("two previews (nothing saved yet) both show the carried opening", () => {
    const saved = [online(52, "AFP069", 11, 11, 0, false), online(53, "AFP070", 11, 11, 0, false)];
    const result = applySharedStockToGrid(saved, saved, "ONLINE")!;
    expect(result.map((r) => r.entry.remainingStock)).toEqual([11, 11]);
  });

  it("passes a missing grid or an incomplete pair through untouched", () => {
    expect(applySharedStockToGrid(null, null, "ONLINE")).toBeNull();
    const rows = [online(52, "AFP069", 11, 7), online(1, "AFP001", 5, 4)];
    expect(applySharedStockToGrid(rows, rows, "ONLINE")).toBe(rows);
  });
});

describe("rowsForColumnTotal (the pool counts once in a total)", () => {
  const r = (id: number, sku: string) => ({ product: { id, sku } });
  const all = [r(52, "AFP069"), r(1, "AFP001"), r(53, "AFP070")];

  it("leaves the second palm oil row out of a total over both, for the columns that show the pool", () => {
    expect(rowsForColumnTotal(all, "remainingStock").map((x) => x.product.id)).toEqual([52, 1]);
    expect(rowsForColumnTotal(all, "openingStock").map((x) => x.product.id)).toEqual([52, 1]);
  });
  it("keeps every row for a column that holds what was typed on each row", () => {
    expect(rowsForColumnTotal(all, "fulfillmentOut")).toBe(all);
  });
  it("a category that holds only one of the two is untouched", () => {
    const category = [r(52, "AFP069"), r(1, "AFP001")];
    expect(rowsForColumnTotal(category, "remainingStock")).toBe(category);
  });
});
