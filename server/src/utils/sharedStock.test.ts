import { describe, expect, it } from "vitest";
import { isSharedStockSku, planSharedCounts, poolShared } from "./sharedStock";

describe("poolShared (one stock behind four rows)", () => {
  it("every row's movements, Online and Offline, count against the one opening", () => {
    const gallonOn = { fulfillmentOut: 3, rts: 0, productionIn: 0 };
    const literOn = { fulfillmentOut: 4, rts: 1, productionIn: 0 };
    const gallonOff = { deliveryOut: 2, backloads: 1, upsellOut: 0, productionIn: 0 };
    const literOff = { deliveryOut: 5, backloads: 0, upsellOut: 1, productionIn: 10 };
    // 20 - 3 - 4 + 1 (online) = 14; + 10 production - 2 - 5 - 1 + 1 backload (offline) = 17
    expect(poolShared(20, [gallonOn, literOn], [gallonOff, literOff])).toEqual({ stock: 20, remaining: 17 });
  });

  it("a transfer between Online and Offline moves nothing: it is inside the pool", () => {
    const online = { stockOutOlToOff: 6, stockInOffToOl: 0, fulfillmentOut: 2 };
    const offline = { stockInOlToOff: 6, stockOutOffToOl: 0, deliveryOut: 1 };
    expect(poolShared(10, [online], [offline])).toEqual({ stock: 10, remaining: 7 });
  });

  it("works while only some of the four rows exist", () => {
    expect(poolShared(11, [], [])).toEqual({ stock: 11, remaining: 11 });
    expect(poolShared(11, [{ fulfillmentOut: 2 }], [])).toEqual({ stock: 11, remaining: 9 });
  });

  it("only the two palm oil SKUs are shared", () => {
    expect(isSharedStockSku("AFP069")).toBe(true);
    expect(isSharedStockSku("AFP070")).toBe(true);
    expect(isSharedStockSku("AFP001")).toBe(false);
    expect(isSharedStockSku(null)).toBe(false);
  });
});

describe("planSharedCounts (counted once for the whole pool)", () => {
  const NOTE = "Not counted in this audit - treated as 0.";
  const at = (s: string) => new Date(`2026-11-27T${s}:00.000Z`);
  const count = (productId: number, location: string, manualCount: number, time: string, remarks: string | null = null) => ({
    productId,
    location,
    manualCount,
    remarks,
    updatedAt: at(time),
  });

  it("takes the figure of whichever row was counted", () => {
    expect(planSharedCounts([count(52, "OFFLINE", 11, "10:00")], [52, 53], NOTE)).toBe(11);
  });

  it("uses the most recently typed count when more than one row was counted", () => {
    const pending = [count(52, "OFFLINE", 11, "10:00"), count(53, "OFFLINE", 9, "10:05"), count(53, "ONLINE", 4, "09:00")];
    expect(planSharedCounts(pending, [52, 53], NOTE)).toBe(9);
  });

  it("never lets a filled-in 'not counted' zero win over a typed count", () => {
    const pending = [count(52, "OFFLINE", 11, "10:00"), count(52, "ONLINE", 0, "10:30", NOTE)];
    expect(planSharedCounts(pending, [52, 53], NOTE)).toBe(11);
  });

  it("ignores other products and the TOTAL view, and returns null when no pool row was counted", () => {
    expect(planSharedCounts([count(7, "OFFLINE", 50, "10:00"), count(52, "TOTAL", 99, "10:00")], [52, 53], NOTE)).toBeNull();
    expect(planSharedCounts([], [52, 53], NOTE)).toBeNull();
  });

  it("a count of exactly 0 typed by someone is a real count", () => {
    expect(planSharedCounts([count(52, "OFFLINE", 0, "10:00")], [52, 53], NOTE)).toBe(0);
  });
});
