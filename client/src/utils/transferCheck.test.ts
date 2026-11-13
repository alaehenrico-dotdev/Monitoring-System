import { describe, expect, it } from "vitest";
import { describeTransferOverwrites, OFFLINE_TRANSFER_PAIRS, ONLINE_TRANSFER_PAIRS, transferOverwrites } from "./transferCheck";

const on = (id: number, entry: Record<string, unknown>) => ({ product: { id, name: `P${id}` }, entry, isSaved: true });
const off = (id: number, entry: Record<string, unknown>, isSaved = true) => ({ product: { id, name: `P${id}` }, entry, isSaved });

describe("transferOverwrites", () => {
  it("flags an Online transfer that disagrees with what Offline already entered", () => {
    const rows = [on(1, { stockOutOlToOff: 5, stockInOffToOl: 0 })];
    const res = transferOverwrites(rows, { 1: { stockOutOlToOff: 5 } }, [off(1, { stockInOlToOff: 8, stockOutOffToOl: 0 })], ONLINE_TRANSFER_PAIRS);
    expect(res).toEqual([{ productId: 1, name: "P1", label: "Stocks Out (Ol→Off)", mine: 5, theirs: 8 }]);
  });

  it("is quiet when both sides already agree", () => {
    const rows = [on(1, { stockOutOlToOff: 8 })];
    expect(transferOverwrites(rows, { 1: { stockOutOlToOff: 8 } }, [off(1, { stockInOlToOff: 8 })], ONLINE_TRANSFER_PAIRS)).toEqual([]);
  });

  it("does not call filling an empty counterpart an overwrite", () => {
    const rows = [on(1, { stockOutOlToOff: 8 })];
    expect(transferOverwrites(rows, { 1: { stockOutOlToOff: 8 } }, [off(1, { stockInOlToOff: 0 })], ONLINE_TRANSFER_PAIRS)).toEqual([]);
    expect(transferOverwrites(rows, { 1: { stockOutOlToOff: 8 } }, [off(1, { stockInOlToOff: 3 }, false)], ONLINE_TRANSFER_PAIRS)).toEqual([]);
  });

  it("only checks products that have a staged transfer cell", () => {
    const rows = [on(1, { stockOutOlToOff: 5, productionIn: 9 })];
    const counterpart = [off(1, { stockInOlToOff: 8 })];
    expect(transferOverwrites(rows, { 1: { productionIn: 9 } }, counterpart, ONLINE_TRANSFER_PAIRS)).toEqual([]);
  });

  it("compares both pairs once one transfer cell is staged, since the mirror writes both", () => {
    const rows = [on(1, { stockOutOlToOff: 5, stockInOffToOl: 2 })];
    const res = transferOverwrites(rows, { 1: { stockOutOlToOff: 5 } }, [off(1, { stockInOlToOff: 5, stockOutOffToOl: 7 })], ONLINE_TRANSFER_PAIRS);
    expect(res).toHaveLength(1);
    expect(res[0]).toMatchObject({ label: "Stocks In (Off→Ol)", mine: 2, theirs: 7 });
  });

  it("works from the Offline side", () => {
    const rows = [off(1, { stockInOlToOff: 4, stockOutOffToOl: 0 })];
    const res = transferOverwrites(rows, { 1: { stockInOlToOff: 4 } }, [on(1, { stockOutOlToOff: 6 })], OFFLINE_TRANSFER_PAIRS);
    expect(res).toEqual([{ productId: 1, name: "P1", label: "Stocks In (Ol→Off)", mine: 4, theirs: 6 }]);
  });

  it("ignores float noise and returns nothing without counterpart rows", () => {
    const rows = [on(1, { stockOutOlToOff: 0.1 + 0.2 })];
    expect(transferOverwrites(rows, { 1: { stockOutOlToOff: 0.3 } }, [off(1, { stockInOlToOff: 0.3 })], ONLINE_TRANSFER_PAIRS)).toEqual([]);
    expect(transferOverwrites(rows, { 1: { stockOutOlToOff: 0.3 } }, null, ONLINE_TRANSFER_PAIRS)).toEqual([]);
    expect(transferOverwrites(null, {}, [], ONLINE_TRANSFER_PAIRS)).toEqual([]);
  });
});

describe("describeTransferOverwrites", () => {
  it("is null when there is nothing to say", () => {
    expect(describeTransferOverwrites([], "Offline")).toBeNull();
  });

  it("names the product, both figures and caps the list", () => {
    const items = Array.from({ length: 6 }, (_, i) => ({ productId: i, name: `P${i}`, label: "Stocks Out (Ol→Off)", mine: 5, theirs: 8 }));
    const text = describeTransferOverwrites(items, "Offline") ?? "";
    expect(text).toMatch(/6 transfer figures/);
    expect(text).toMatch(/P0 - Stocks Out \(Ol→Off\) 5 \(Offline has 8\)/);
    expect(text).toMatch(/and 2 more/);
  });
});
