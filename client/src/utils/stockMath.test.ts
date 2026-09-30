import { describe, expect, it } from "vitest";
import { calculateOfflineRemaining, calculateOfflineStock, calculateOnlineRemaining, calculateOnlineStock, isNegativeStock } from "./stockMath";

// Same pinned cases as server/src/utils/stockMath.test.ts - this file is a
// hand-kept mirror of that one (see this file's own top-of-file comment),
// so a fix there (like the Backloads sign) needs its matching case updated
// here too, or the two silently drift apart.

describe("calculateOnlineStock / calculateOnlineRemaining", () => {
  it("onlineStock is opening + in - out, remaining adds Production and RTS, subtracts Fulfillment", () => {
    expect(calculateOnlineStock(100, 20, 5)).toBe(115);
    expect(calculateOnlineRemaining(115, 10, 20, 2)).toBe(107);
  });
});

describe("calculateOfflineStock / calculateOfflineRemaining", () => {
  it("offlineStock is opening + in - out", () => {
    expect(calculateOfflineStock(50, 5, 10)).toBe(45);
  });

  it("ADDS Backloads back onto Remaining Stock - real monthly report figures", () => {
    // offlineStock=3554, productionIn=804, deliveryOut=752, backloads=29,
    // upsellOut=0 -> 3635, not 3577 (see server's own pinned test for the
    // report this comes from).
    expect(calculateOfflineRemaining(3554, 804, 752, 29, 0)).toBe(3635);
  });

  it("subtracts Upsell (Out) the same way as Delivery (Out)", () => {
    expect(calculateOfflineRemaining(45, 8, 12, 3, 5)).toBe(39);
  });
});

describe("isNegativeStock", () => {
  it("flags a negative Remaining Stock, not zero", () => {
    expect(isNegativeStock(-0.01)).toBe(true);
    expect(isNegativeStock(0)).toBe(false);
  });

  it("does not flag binary-floating-point noise from an exact-zero result as negative", () => {
    // Same pinned case as server/src/utils/stockMath.test.ts - see its
    // comment for why 0.7 + 0.1 - 0.8 isn't exactly 0 in raw IEEE-754 floats.
    expect(calculateOnlineRemaining(0.7, 0.1, 0.8, 0)).toBe(0);
    expect(isNegativeStock(calculateOnlineRemaining(0.7, 0.1, 0.8, 0))).toBe(false);
    expect(calculateOfflineRemaining(0.7, 0.1, 0.8, 0, 0)).toBe(0);
    expect(isNegativeStock(calculateOfflineRemaining(0.7, 0.1, 0.8, 0, 0))).toBe(false);
  });
});
