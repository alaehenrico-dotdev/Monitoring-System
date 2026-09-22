import { describe, expect, it } from "vitest";
import {
  findHeaderRowIndex,
  findMatchingProduct,
  findProductColumnIndex,
  matchColumnIndexes,
  unmatchedColumns,
  type ImportableColumn,
} from "./importMatch";

// The static (non-destination) part of buildOfflineStockColumns/onlineStockColumns
// from config/stockColumns.ts, duplicated here rather than imported so this test
// doesn't need a DeliveryDestination[] just to exercise the column-matching logic.
const offlineColumns: ImportableColumn[] = [
  { key: "openingStock", label: "Stocks (Opening)", editable: false, importable: true, aliases: ["Stocks"] },
  { key: "stockInOlToOff", label: "Stocks In (Ol→Off)", editable: true, aliases: ["Stocks In"] },
  { key: "stockOutOffToOl", label: "Stocks Out (Off→Ol)", editable: true, aliases: ["Stocks Out"] },
  { key: "offlineStock", label: "Offline Stocks", editable: false },
  { key: "productionIn", label: "Production (In)", editable: true },
  { key: "deliveryOut", label: "Delivery (Out)", editable: false, importable: true, aliases: ["Delivery(Out)"] },
  { key: "upsellOut", label: "Upsell (Out)", editable: true },
  { key: "backloads", label: "Backloads", editable: true, aliases: ["Backload"] },
  { key: "remainingStock", label: "Remaining Stocks", editable: false },
];

const onlineColumns: ImportableColumn[] = [
  { key: "openingStock", label: "Stocks (Opening)", editable: false, importable: true, aliases: ["Stocks"] },
  { key: "stockInOffToOl", label: "Stocks In (Off→Ol)", editable: true, aliases: ["Stocks In"] },
  { key: "stockOutOlToOff", label: "Stocks Out (Ol→Off)", editable: true, aliases: ["Stocks Out"] },
  { key: "onlineStock", label: "Online Stocks", editable: false },
  { key: "productionIn", label: "Production (In)", editable: true },
  { key: "fulfillmentOut", label: "Fulfillment (Out)", editable: true, aliases: ["Fullfilment (Out)"] },
  { key: "rts", label: "RTS", editable: true },
  { key: "remainingStock", label: "Remaining Stocks", editable: false },
];

// Verbatim header rows from the real monthly report files (Section 8.1) -
// see PRODUCTS,... row of "Offline Monitoring - Sept ... .csv" and
// "Online Monitoring - Sept ... .csv".
const OFFLINE_REPORT_HEADER = [
  "PRODUCTS", " STOCKS", "STOCKS IN", "STOCKS OUT", "OFFLINE STOCKS", "PRODUCTION (IN)",
  "WESTERN UPSELL", "WESTERN", "CAVITE", "SAMPLE PROD", "DELIVERY(OUT)", "UPSELL (OUT)",
  "BACKLOAD", "REAINING STOCKS", "MANUAL COUNTING", "VARIANCE",
];
const ONLINE_REPORT_HEADER = [
  "PRODUCTS", " STOCKS", "STOCKS IN", "STOCKS OUT", "ONLINE STOCKS", "PRODUCTION (IN)",
  "FULLFILMENT (OUT)", "RTS", "REAINING STOCKS", "MANUAL COUNTING", "VARIANCE", "", "",
];

describe("findHeaderRowIndex / findProductColumnIndex", () => {
  it("finds the header row even when it isn't row 0", () => {
    const table = [["Ala Eh Offline Monitoring"], [], OFFLINE_REPORT_HEADER, ["SPECIAL", "240"]];
    expect(findHeaderRowIndex(table)).toBe(2);
  });

  it("accepts Product/Products/SKU/SKUs interchangeably", () => {
    for (const name of ["Product", "Products", "SKU", "SKUs"]) {
      expect(findHeaderRowIndex([[name, "Stocks"]])).toBe(0);
    }
  });

  it("returns -1 when no row has a recognizable product column", () => {
    expect(findHeaderRowIndex([["A", "B"], ["1", "2"]])).toBe(-1);
  });

  it("locates PRODUCTS case-insensitively within the header row", () => {
    const header = OFFLINE_REPORT_HEADER.map((h) => h.toLowerCase());
    expect(findProductColumnIndex(header)).toBe(0);
  });
});

describe("matchColumnIndexes against the real monthly report", () => {
  it("resolves every offline column, including the Backload/Backloads spelling mismatch", () => {
    const idx = matchColumnIndexes(offlineColumns, OFFLINE_REPORT_HEADER);
    const keys = idx.map((c) => c.key).sort();
    expect(keys).toEqual(
      ["openingStock", "stockInOlToOff", "stockOutOffToOl", "productionIn", "deliveryOut", "upsellOut", "backloads"].sort(),
    );
    // "Remaining Stocks" / "Offline Stocks" are intentionally excluded: they're
    // computed columns (editable: false, importable not set), not read from a file.
  });

  it("resolves every online column, including the Fulfillment/Fullfilment typo", () => {
    const idx = matchColumnIndexes(onlineColumns, ONLINE_REPORT_HEADER);
    const keys = idx.map((c) => c.key).sort();
    expect(keys).toEqual(
      ["openingStock", "stockInOffToOl", "stockOutOlToOff", "productionIn", "fulfillmentOut", "rts"].sort(),
    );
  });

  it("has no missing columns for either report once every alias is in place", () => {
    expect(unmatchedColumns(offlineColumns, OFFLINE_REPORT_HEADER)).toEqual([]);
    expect(unmatchedColumns(onlineColumns, ONLINE_REPORT_HEADER)).toEqual([]);
  });

  it("regression: BACKLOAD (singular) must resolve to the backloads column", () => {
    // This is the one column that did NOT resolve before the "Backload" alias
    // was added - kept as its own explicit case so a future edit that drops
    // the alias fails loudly here instead of only showing up as silently
    // unchanged backload figures after a real import.
    const idx = matchColumnIndexes(offlineColumns, OFFLINE_REPORT_HEADER);
    expect(idx.find((c) => c.key === "backloads")?.idx).toBe(OFFLINE_REPORT_HEADER.indexOf("BACKLOAD"));
  });

  it("flags a genuinely missing column instead of matching it to something else", () => {
    const headerWithoutRts = ONLINE_REPORT_HEADER.filter((h) => h !== "RTS");
    const missing = unmatchedColumns(onlineColumns, headerWithoutRts);
    expect(missing.map((c) => c.key)).toEqual(["rts"]);
  });
});

describe("matchColumnIndexes against the Manual Count columns (config in ManualCountPage.tsx)", () => {
  // Mirrors ManualCountPage.tsx's own csvColumns - duplicated here for the
  // same reason offlineColumns/onlineColumns above are: this test doesn't
  // need to render the page just to exercise header matching.
  const manualCountColumns: ImportableColumn[] = [
    { key: "systemRemainingStock", label: "System Remaining" },
    { key: "manualCount", label: "Manual Count", editable: true, aliases: ["Manual Counting"] },
    { key: "variance", label: "Variance" },
  ];

  it("regression: MANUAL COUNTING (the real report's own wording) must resolve to the manualCount column", () => {
    const idx = matchColumnIndexes(manualCountColumns, OFFLINE_REPORT_HEADER);
    expect(idx.find((c) => c.key === "manualCount")?.idx).toBe(OFFLINE_REPORT_HEADER.indexOf("MANUAL COUNTING"));
    // Same header text appears in the Online report too.
    expect(matchColumnIndexes(manualCountColumns, ONLINE_REPORT_HEADER).find((c) => c.key === "manualCount")?.idx).toBe(
      ONLINE_REPORT_HEADER.indexOf("MANUAL COUNTING"),
    );
  });

  it("never reads the file's own VARIANCE column - it's always system-derived, never imported", () => {
    const idx = matchColumnIndexes(manualCountColumns, OFFLINE_REPORT_HEADER);
    expect(idx.map((c) => c.key)).toEqual(["manualCount"]);
  });
});

describe("findMatchingProduct - duplicate product names across categories", () => {
  // "Sweet A" genuinely exists in more than one category on the real product
  // list (Section 4.1) - e.g. once as a Liter SKU, once as a Gallon SKU.
  const rows = [
    { product: { id: 1, name: "Sweet A", category: "Class A (Liter)" } },
    { product: { id: 2, name: "Sweet A", category: "Class A (Gallon)" } },
    { product: { id: 3, name: "Toyo Mansi", category: "Premium (350ML)" } },
  ];

  it("resolves to the right SKU when the category is known", () => {
    expect(findMatchingProduct(rows, "SWEET A", "CLASS A (GALLON)")?.product.id).toBe(2);
    expect(findMatchingProduct(rows, "Sweet A", "Class A (Liter)")?.product.id).toBe(1);
  });

  it("is case/punctuation-insensitive on both the name and the category", () => {
    // Mirrors the real report's own inconsistency: "CLASS A -(LITER)" (with a
    // stray dash) vs the app's own "Class A (Liter)".
    expect(findMatchingProduct(rows, "sweet a", "CLASS A -(LITER)")?.product.id).toBe(1);
  });

  it("returns undefined for a name that matches but in a category it was never in", () => {
    expect(findMatchingProduct(rows, "Sweet A", "Premium (350ML)")).toBeUndefined();
  });

  it("falls back to the first name-only match when no category is given", () => {
    // Only safe because CsvTools always supplies a category once one's known
    // (see its own currentCategory tracking) - documented here so a caller
    // that skips category isn't surprised which of the duplicates it gets.
    expect(findMatchingProduct(rows, "Sweet A", undefined)?.product.id).toBe(1);
  });

  it("still matches a product whose name doesn't repeat, category or not", () => {
    expect(findMatchingProduct(rows, "Toyo Mansi", undefined)?.product.id).toBe(3);
    expect(findMatchingProduct(rows, "TOYO MANSI", "PREMIUM (350ML)")?.product.id).toBe(3);
  });
});
