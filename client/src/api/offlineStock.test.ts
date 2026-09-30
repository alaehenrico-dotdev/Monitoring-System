import { describe, expect, it } from "vitest";
import { computeDeliverySlots } from "./offlineStock";

describe("computeDeliverySlots", () => {
  const entry = { delivery1: 20, delivery2: 5, delivery3: 0, delivery4: 0, delivery5: 0, deliveryOut: 25 };

  it("folds only the changed slot(s) into the saved ones and sums all five", () => {
    expect(computeDeliverySlots(entry, { delivery2: 8 })).toMatchObject({ delivery1: 20, delivery2: 8, deliveryOut: 28 });
  });

  it("sums every slot when more than one changes", () => {
    expect(computeDeliverySlots(entry, { delivery1: 1, delivery5: 4 }).deliveryOut).toBe(10); // 1 + 5 + 4
  });

  it("puts a flat deliveryOut (CSV import) in slot 1 and zeroes the rest", () => {
    expect(computeDeliverySlots(entry, { deliveryOut: 99 })).toMatchObject({ delivery1: 99, delivery2: 0, deliveryOut: 99 });
  });

  it("keeps the saved total when nothing delivery-related changed", () => {
    expect(computeDeliverySlots(entry, { backloads: 3 }).deliveryOut).toBe(25);
  });
});
