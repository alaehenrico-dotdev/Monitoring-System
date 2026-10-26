import { describe, expect, it } from "vitest";
import {
  columnKeysOf,
  sumExtras,
  unionLayouts,
  DELIVERY_LEGACY_SLOTS,
  deliveryExtrasFromLegacy,
  layoutCells,
  layoutCellsFor,
  sheetHasDeliveryBreakdown,
  splitDeliveryExtras,
  EXTRA_COLUMNS,
  extraCellKey,
  parseExtraCellKey,
  flattenExtras,
  isExtraColumn,
  MAX_EXTRAS_PER_COLUMN,
  totalsFromExtras,
  validateExtras,
  type StockExtraInput,
} from "./stockExtras";

const extra = (columnKey: string, slotIndex: number, amount: number): StockExtraInput => ({ columnKey, slotIndex, amount });

describe("which columns can have extras", () => {
  it("accepts each grid's editable movement columns", () => {
    for (const key of EXTRA_COLUMNS.ONLINE) expect(isExtraColumn("ONLINE", key)).toBe(true);
    for (const key of EXTRA_COLUMNS.OFFLINE) expect(isExtraColumn("OFFLINE", key)).toBe(true);
  });

  it("rejects calculated columns, the carried-forward opening stock and the other grid's columns", () => {
    for (const key of ["onlineStock", "offlineStock", "remainingStock", "openingStock", "delivery1"]) {
      expect(isExtraColumn("ONLINE", key)).toBe(false);
      expect(isExtraColumn("OFFLINE", key)).toBe(false);
    }
    // Online's own columns are not Offline's, and vice versa.
    expect(isExtraColumn("OFFLINE", "fulfillmentOut")).toBe(false);
    expect(isExtraColumn("ONLINE", "backloads")).toBe(false);
    // TOTAL is derived, never encoded.
    expect(isExtraColumn("TOTAL", "productionIn")).toBe(false);
  });

  it("accepts Delivery (Out), which is no longer limited to five fixed columns", () => {
    expect(isExtraColumn("OFFLINE", "deliveryOut")).toBe(true);
    // Still an Offline column only.
    expect(isExtraColumn("ONLINE", "deliveryOut")).toBe(false);
  });
});

describe("the main column is the sum of its extras", () => {
  it("totals each column separately", () => {
    expect(totalsFromExtras([extra("rts", 1, 5), extra("rts", 2, 4), extra("productionIn", 1, 3)])).toEqual({
      rts: 9,
      productionIn: 3,
    });
  });

  it("is an empty set of totals when nothing was sent, so no column is overridden", () => {
    expect(totalsFromExtras([])).toEqual({});
  });

  it("names the distinct columns a save touches", () => {
    expect(columnKeysOf([extra("rts", 1, 5), extra("rts", 2, 4), extra("productionIn", 1, 3)])).toEqual(["rts", "productionIn"]);
  });
});

describe("the wire format shared with the client", () => {
  it("keys an amount by its column and slot", () => {
    expect(extraCellKey("fulfillmentOut", 3)).toBe("fulfillmentOut__x3");
  });

  it("flattens stored amounts onto a grid row", () => {
    expect(flattenExtras([{ columnKey: "rts", slotIndex: 1, amount: "5.00" }, { columnKey: "rts", slotIndex: 4, amount: 2 }])).toEqual({
      rts__x1: 5,
      rts__x4: 2,
    });
  });
});

describe("validateExtras", () => {
  it("passes a well-formed set", () => {
    expect(validateExtras("ONLINE", [extra("rts", 1, 5), extra("rts", 2, 0), extra("productionIn", 1, 3)])).toBeUndefined();
  });

  it("rejects a column that cannot have extras", () => {
    expect(validateExtras("ONLINE", [extra("remainingStock", 1, 5)])).toMatch(/not a column that can have extra columns/);
    expect(validateExtras("ONLINE", [extra("backloads", 1, 5)])).toMatch(/not a column that can have extra columns/);
  });

  it("rejects two amounts for the same added column", () => {
    expect(validateExtras("ONLINE", [extra("rts", 2, 5), extra("rts", 2, 6)])).toMatch(/two amounts for the same added column/);
  });

  it("rejects more than the cap on one column, while allowing exactly the cap", () => {
    const atCap = Array.from({ length: MAX_EXTRAS_PER_COLUMN }, (_, i) => extra("rts", i + 1, 1));
    expect(validateExtras("ONLINE", atCap)).toBeUndefined();
    expect(validateExtras("ONLINE", [...atCap, extra("rts", MAX_EXTRAS_PER_COLUMN + 1, 1)])).toMatch(/at most/);
  });

  it("counts the cap per column, not across the whole request", () => {
    const spread = [
      ...Array.from({ length: MAX_EXTRAS_PER_COLUMN }, (_, i) => extra("rts", i + 1, 1)),
      ...Array.from({ length: MAX_EXTRAS_PER_COLUMN }, (_, i) => extra("productionIn", i + 1, 1)),
    ];
    expect(validateExtras("ONLINE", spread)).toBeUndefined();
  });
});

describe("Delivery (Out)'s legacy slot columns", () => {
  it("writes the first five added columns into the legacy columns, zeroing the untouched ones", () => {
    const { legacy, overflow } = splitDeliveryExtras([
      extra("deliveryOut", 1, 20),
      extra("deliveryOut", 3, 5),
    ]);
    expect(legacy).toEqual({ delivery1: 20, delivery2: 0, delivery3: 5, delivery4: 0, delivery5: 0 });
    expect(overflow).toEqual([]);
  });

  it("sends anything past the fifth to daily_stock_extra instead", () => {
    const { legacy, overflow } = splitDeliveryExtras([
      extra("deliveryOut", 5, 4),
      extra("deliveryOut", 6, 7),
      extra("deliveryOut", 9, 1),
    ]);
    expect(legacy.delivery5).toBe(4);
    expect(overflow).toEqual([extra("deliveryOut", 6, 7), extra("deliveryOut", 9, 1)]);
  });

  it("ignores other columns' extras", () => {
    const { legacy, overflow } = splitDeliveryExtras([extra("backloads", 1, 9)]);
    expect(Object.values(legacy).every((v) => v === 0)).toBe(true);
    expect(overflow).toEqual([]);
  });

  it("reads an existing breakdown back as added columns", () => {
    expect(deliveryExtrasFromLegacy({ delivery1: 20, delivery2: 5, delivery3: 0, delivery4: 0, delivery5: 0 })).toEqual([
      extra("deliveryOut", 1, 20),
      extra("deliveryOut", 2, 5),
    ]);
  });

  it("treats a figure sitting entirely in slot 1 as a flat total, not a breakdown", () => {
    // Where a plain typed figure and a CSV import both land - surfacing an
    // added column for it would put a spurious "+1" on every existing sheet.
    expect(deliveryExtrasFromLegacy({ delivery1: 25, delivery2: 0, delivery3: 0, delivery4: 0, delivery5: 0 })).toEqual([]);
    expect(deliveryExtrasFromLegacy({ delivery1: 0, delivery2: 0, delivery3: 0, delivery4: 0, delivery5: 0 })).toEqual([]);
  });

  it("surfaces a single-destination product once the sheet is known to be split", () => {
    const single = { delivery1: 0, delivery2: 7, delivery3: 0, delivery4: 0, delivery5: 0 };
    expect(deliveryExtrasFromLegacy(single)).toEqual([extra("deliveryOut", 2, 7)]);
    const slotOne = { delivery1: 9, delivery2: 0, delivery3: 0, delivery4: 0, delivery5: 0 };
    expect(deliveryExtrasFromLegacy(slotOne)).toEqual([]);
    expect(deliveryExtrasFromLegacy(slotOne, true)).toEqual([extra("deliveryOut", 1, 9)]);
    const split = { delivery1: 20, delivery2: 5, delivery3: 0, delivery4: 0, delivery5: 0 };
    expect(sheetHasDeliveryBreakdown([slotOne, split])).toBe(true);
    expect(sheetHasDeliveryBreakdown([slotOne])).toBe(false);
  });

  it("round-trips a full five-column breakdown", () => {
    const row: Record<string, number> = {};
    for (let slot = 1; slot <= DELIVERY_LEGACY_SLOTS; slot++) row[`delivery${slot}`] = slot;
    const read = deliveryExtrasFromLegacy(row);
    expect(read).toHaveLength(DELIVERY_LEGACY_SLOTS);
    expect(totalsFromExtras(read)).toEqual({ deliveryOut: 15 });
    expect(splitDeliveryExtras(read).legacy).toEqual(row);
  });
});

describe("layoutCells", () => {
  it("turns a stored layout into zero-valued cells under the client's keys", () => {
    expect(layoutCells([{ columnKey: "deliveryOut", slotIndex: 1 }, { columnKey: "deliveryOut", slotIndex: 3 }])).toEqual({
      deliveryOut__x1: 0,
      deliveryOut__x3: 0,
    });
    expect(layoutCells([])).toEqual({});
  });
});

describe("layoutCellsFor", () => {
  const layout = [
    { columnKey: "deliveryOut", slotIndex: 1 },
    { columnKey: "deliveryOut", slotIndex: 2 },
  ];

  it("keeps a flat total visible by seeding it into the first added column", () => {
    expect(layoutCellsFor(layout, [], { deliveryOut: "9.00" })).toEqual({ deliveryOut__x1: 9, deliveryOut__x2: 0 });
  });

  it("leaves a row that already has amounts for the column to those amounts", () => {
    expect(layoutCellsFor(layout, [{ columnKey: "deliveryOut" }], { deliveryOut: "9.00" })).toEqual({ deliveryOut__x1: 0, deliveryOut__x2: 0 });
  });

  it("adds nothing for a zero total", () => {
    expect(layoutCellsFor(layout, [], { deliveryOut: "0.00" })).toEqual({ deliveryOut__x1: 0, deliveryOut__x2: 0 });
  });

  it("seeds into the lowest slot even when it is not slot 1", () => {
    expect(layoutCellsFor([{ columnKey: "rts", slotIndex: 3 }, { columnKey: "rts", slotIndex: 2 }], [], { rts: 4 })).toEqual({ rts__x3: 0, rts__x2: 4 });
  });
});

describe("sumExtras / unionLayouts (a day entered by shift, viewed as one sheet)", () => {
  it("adds the Morning and Night amount of each added column", () => {
    const morning = [{ columnKey: "deliveryOut", slotIndex: 1, amount: 4 }, { columnKey: "deliveryOut", slotIndex: 2, amount: 1 }];
    const night = [{ columnKey: "deliveryOut", slotIndex: 1, amount: 6 }];
    expect(sumExtras(morning, night)).toEqual([
      { columnKey: "deliveryOut", slotIndex: 1, amount: 10 },
      { columnKey: "deliveryOut", slotIndex: 2, amount: 1 },
    ]);
  });

  it("keeps a column that only one of the sheets was saved with", () => {
    const merged = unionLayouts([{ columnKey: "deliveryOut", slotIndex: 1 }], [{ columnKey: "deliveryOut", slotIndex: 1 }, { columnKey: "deliveryOut", slotIndex: 2 }]);
    expect(merged).toHaveLength(2);
  });
});

describe("parseExtraCellKey", () => {
  it("is the reverse of extraCellKey", () => {
    for (const [column, slot] of [["fulfillmentOut", 1], ["deliveryOut", 10], ["stockInOffToOl", 3]] as const) {
      expect(parseExtraCellKey(extraCellKey(column, slot))).toEqual({ columnKey: column, slotIndex: slot });
    }
  });

  it("is null for an ordinary column or a malformed key", () => {
    for (const key of ["remainingStock", "__x1", "deliveryOut__x", "deliveryOut__x0", "deliveryOut__x1.5", "deliveryOut__xA"]) {
      expect(parseExtraCellKey(key)).toBeNull();
    }
  });
});
