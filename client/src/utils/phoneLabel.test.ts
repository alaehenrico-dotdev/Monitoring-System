import { describe, expect, it } from "vitest";
import { phoneLabel, phoneTitle } from "./phoneLabel";

describe("phoneLabel", () => {
  it("shortens the known filter wordings", () => {
    expect(phoneLabel("All categories")).toBe("Categories");
    expect(phoneLabel("Both shifts")).toBe("Shifts");
    expect(phoneLabel("Any date")).toBe("Date");
    expect(phoneLabel("Online + Offline")).toBe("Both");
    expect(phoneLabel("Last 14 days")).toBe("14d");
    expect(phoneLabel("Full Report (Online + Offline + Audit)")).toBe("Full");
  });
  it("leaves data alone", () => {
    expect(phoneLabel("Class A (Liter)")).toBe("Class A (Liter)");
    expect(phoneLabel("Online")).toBe("Online");
    expect(phoneLabel("All")).toBe("All");
  });
});

describe("phoneTitle", () => {
  it("drops the date and the bracketed detail", () => {
    expect(phoneTitle("Daily Report - November 10, 2026")).toBe("Daily Report");
    expect(phoneTitle("Consolidated (Online + Offline) - November 10, 2026")).toBe("Consolidated");
    expect(phoneTitle("Dashboard")).toBe("Dashboard");
  });
});
