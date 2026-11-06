import { describe, expect, it } from "vitest";
import type { TotalStockRow } from "../types";
import { makeDelta, summarize } from "./dashboardTotals";

// The dashboard's two stock figures must equal the Consolidated page's GRAND TOTAL row, which
// sums with sumRounded. These guard the float noise a plain sum leaves behind.
const row = (online: number, offline: number) => ({ onlineRemainingStock: online, offlineRemainingStock: offline }) as TotalStockRow;

describe("dashboard stock totals", () => {
  it("sums to the database's two decimals, without float noise", () => {
    expect(0.1 + 0.2).not.toBe(0.3); // the noise a plain reduce would leave
    expect(summarize([row(0.1, 1.1), row(0.2, 2.2)])).toEqual({ online: 0.3, offline: 3.3 });
  });

  it("never reports a negative zero", () => {
    const t = summarize([row(0.1, 0), row(-0.1, 0)]);
    expect(Object.is(t.online, -0)).toBe(false);
    expect(t.online).toBe(0);
  });

  it("treats missing figures as 0", () => {
    expect(summarize([row(5, 0), { onlineRemainingStock: null, offlineRemainingStock: undefined } as unknown as TotalStockRow])).toEqual({ online: 5, offline: 0 });
  });

  it("reports equal figures as no change, and real changes exactly", () => {
    expect(makeDelta(0.3, 0.1 + 0.2)).toEqual({ diff: 0 });
    expect(makeDelta(10.5, 8.25)).toEqual({ diff: 2.25 });
    expect(makeDelta(8, 10)).toEqual({ diff: -2 });
    expect(makeDelta(5, undefined)).toBeUndefined();
  });
});
