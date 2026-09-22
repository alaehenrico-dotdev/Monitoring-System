import { describe, expect, it } from "vitest";
import { computeNewDeliveryOut, deliveryColumnKey } from "./offlineStock";

describe("computeNewDeliveryOut", () => {
  const entry = {
    deliveryOut: 20,
    [deliveryColumnKey(1)]: 12,
    [deliveryColumnKey(2)]: 8,
  };

  it("folds only the changed destination(s) into the existing per-destination total", () => {
    // Only destination 1 changes (12 -> 15); destination 2's 8 carries
    // forward untouched - same partial-update rule the server enforces.
    expect(computeNewDeliveryOut(entry, { [deliveryColumnKey(1)]: 15 })).toBe(23); // 15 + 8
  });

  it("sums every destination when more than one changes", () => {
    expect(computeNewDeliveryOut(entry, { [deliveryColumnKey(1)]: 15, [deliveryColumnKey(2)]: 5 })).toBe(20); // 15 + 5
  });

  it("uses a flat deliveryOut directly when no destination sub-key is present (CSV backward compat)", () => {
    expect(computeNewDeliveryOut(entry, { deliveryOut: 99 })).toBe(99);
  });

  it("falls back to the entry's existing flat deliveryOut when nothing changed at all", () => {
    expect(computeNewDeliveryOut(entry, {})).toBe(20);
  });
});
