import { describe, expect, it } from "vitest";
import { diffChanges, fieldLabel, summarizeChange } from "./changeSummary";

describe("summarizeChange", () => {
  it("reads a single edit with a friendly field name", () => {
    expect(summarizeChange("UPDATE", { manualCount: "12.00" }, { manualCount: "10.00" })).toBe("Manual count 12 → 10");
  });

  it("lists the typed figure before the calculated ones it moved", () => {
    const s = summarizeChange("UPDATE", { remainingStock: "20", productionIn: "5" }, { remainingStock: "25", productionIn: "10" });
    expect(s).toBe("Production in 5 → 10; Remaining stock 20 → 25");
  });

  it("caps the line and says how many more", () => {
    const s = summarizeChange(
      "UPDATE",
      { rts: 0, delivery1: 0, delivery2: 0, delivery3: 0, delivery4: 0 },
      { rts: 1, delivery1: 1, delivery2: 1, delivery3: 1, delivery4: 1 },
    );
    expect(s).toBe("RTS 0 → 1; Delivery 1 0 → 1; Delivery 2 0 → 1; +2 more");
  });

  it("ignores identity and timestamp fields", () => {
    expect(summarizeChange("UPDATE", { id: 1, updatedAt: "a", shift: "NIGHT" }, { id: 1, updatedAt: "b", shift: "MORNING" })).toBe(
      "No field changes recorded",
    );
  });

  it("treats 12 and '12.00' as the same value", () => {
    expect(diffChanges({ manualCount: 12 }, { manualCount: "12.00" })).toEqual([]);
  });

  it("lists only entered figures on a create, skipping zero defaults", () => {
    expect(summarizeChange("CREATE", null, { productionIn: "5.00", rts: "0.00", id: 4 })).toBe("Created · Production in 5");
    expect(summarizeChange("CREATE", null, { rts: 0 })).toBe("Created");
  });

  it("says what a delete removed", () => {
    expect(summarizeChange("DELETE", { manualCount: "10.00" }, null)).toBe("Deleted · Manual count 10");
  });

  it("shows booleans and blanks plainly", () => {
    expect(summarizeChange("UPDATE", { isActive: true, lowStockThreshold: null }, { isActive: false, lowStockThreshold: "50.00" })).toBe(
      "Active Yes → No; Low stock threshold — → 50",
    );
  });
});

describe("fieldLabel", () => {
  it("humanises unknown keys", () => {
    expect(fieldLabel("extraBoxCount")).toBe("Extra box count");
  });
});

describe("summarizeChange - publishing a count", () => {
  it("reads as a state change, not a timestamp", () => {
    expect(summarizeChange("UPDATE", { manualCount: 5, publishedAt: null, publishedById: null }, { manualCount: 5, publishedAt: "2026-10-09T22:00:00.000Z", publishedById: 3 })).toBe(
      "Publication Not published → Published",
    );
  });

  it("shows an edit taking a published count back to unpublished", () => {
    expect(summarizeChange("UPDATE", { manualCount: 5, publishedAt: "2026-10-09T22:00:00.000Z" }, { manualCount: 4, publishedAt: null })).toBe(
      "Manual count 5 → 4; Publication Published → Not published",
    );
  });

  it("does not mention publication on a brand-new unpublished count", () => {
    expect(summarizeChange("CREATE", null, { manualCount: 5, publishedAt: null })).toBe("Created · Manual count 5");
  });
});
