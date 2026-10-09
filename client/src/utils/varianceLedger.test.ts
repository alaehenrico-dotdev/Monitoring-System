import { describe, expect, it } from "vitest";
import { buildVarianceLedger, varianceLedgerCsv, type LedgerCount } from "./varianceLedger";

let id = 0;
const count = (productId: number, name: string, date: string, variance: number, over: Partial<LedgerCount> = {}): LedgerCount => ({
  id: ++id,
  entryDate: `${date}T00:00:00.000Z`,
  location: "ONLINE",
  systemRemainingStock: 100,
  manualCount: 100 - variance,
  variance,
  remarks: null,
  product: { id: productId, sku: `SKU${productId}`, name, category: "Sauces" },
  countedBy: { name: "Ana" },
  ...over,
});

describe("buildVarianceLedger", () => {
  it("rolls counts up per SKU with totals that do not let opposite variances cancel", () => {
    const [soy] = buildVarianceLedger([
      count(1, "Soy", "2026-10-01", 5),
      count(1, "Soy", "2026-10-02", -5),
      count(1, "Soy", "2026-10-03", 0),
    ]);

    expect(soy).toMatchObject({ counts: 3, flagged: 2, net: 0, absolute: 10, largest: 5, recurring: true, lastFlaggedDate: "2026-10-02" });
  });

  it("ranks the worst SKU first", () => {
    const rows = buildVarianceLedger([count(1, "Vinegar", "2026-10-01", 1), count(2, "Soy", "2026-10-01", 9), count(3, "Rice", "2026-10-01", 0)]);
    expect(rows.map((r) => r.name)).toEqual(["Soy", "Vinegar", "Rice"]);
  });

  it("is not recurring for a single miss, and has no last-off date for a clean SKU", () => {
    const rows = buildVarianceLedger([count(1, "Soy", "2026-10-01", 4), count(2, "Rice", "2026-10-01", 0)]);
    expect(rows[0].recurring).toBe(false);
    expect(rows[1]).toMatchObject({ flagged: 0, lastFlaggedDate: null, absolute: 0 });
  });

  it("names who counted a SKU most, with a stable tie-break", () => {
    const [soy] = buildVarianceLedger([
      count(1, "Soy", "2026-10-01", 1, { countedBy: { name: "Ben" } }),
      count(1, "Soy", "2026-10-02", 1, { countedBy: { name: "Ana" } }),
      count(1, "Soy", "2026-10-03", 1, { countedBy: { name: "Ben" } }),
    ]);
    expect(soy.topCounter).toEqual({ name: "Ben", times: 2 });
  });

  it("handles a count with no recorded counter", () => {
    const [soy] = buildVarianceLedger([count(1, "Soy", "2026-10-01", 1, { countedBy: null })]);
    expect(soy.topCounter).toBeNull();
  });

  it("counts only flagged counts that carry an explanation", () => {
    const [soy] = buildVarianceLedger([
      count(1, "Soy", "2026-10-01", 3, { remarks: "Spoilage" }),
      count(1, "Soy", "2026-10-02", 3, { remarks: "   " }),
      count(1, "Soy", "2026-10-03", 0, { remarks: "n/a" }),
    ]);
    expect(soy.explained).toBe(1);
  });

  it("reads Decimal strings from the API as numbers and keeps entries newest first", () => {
    const [soy] = buildVarianceLedger([count(1, "Soy", "2026-10-01", 0, { variance: "2.50" }), count(1, "Soy", "2026-10-05", 0, { variance: "1.25" })]);
    expect(soy.net).toBe(3.75);
    expect(soy.entries.map((e) => e.entryDate.slice(0, 10))).toEqual(["2026-10-05", "2026-10-01"]);
  });

  it("returns nothing for no counts", () => {
    expect(buildVarianceLedger([])).toEqual([]);
  });
});

describe("varianceLedgerCsv", () => {
  it("writes one escaped line per SKU", () => {
    const csv = varianceLedgerCsv(buildVarianceLedger([count(1, "Soy, light", "2026-10-02", 5, { remarks: "Spoilage" })]));
    const [header, line] = csv.split("\r\n");
    expect(header).toBe("SKU,Product,Category,Counts,Off,Net variance,Total discrepancy,Largest,Last off,Counted most by,Explained");
    expect(line).toBe('SKU1,"Soy, light",Sauces,1,1,5,5,5,2026-10-02,Ana (1),1/1');
  });

  it("neutralises formula-looking product names", () => {
    expect(varianceLedgerCsv(buildVarianceLedger([count(1, "=SUM(A1)", "2026-10-02", 1)]))).toContain("'=SUM(A1)");
  });
});
