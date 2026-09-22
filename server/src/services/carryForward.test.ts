import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Section 4.6 - "auto carry-forward": each day's Remaining Stock becomes the
 * next day's Opening Stock, for both Online and Offline. This isn't
 * meaningfully testable against a fixed mock return value (that only proves
 * the service reads whatever getOpeningStock happens to return) - the actual
 * risk is drift across a real multi-day sequence, so this drives several
 * consecutive real saveOfflineEntry/saveOnlineEntry calls against a small
 * stateful in-memory repository double that mimics "the immediately
 * preceding day's remainingStock", the same contract the real Prisma-backed
 * getOpeningStock implements.
 */

interface FakeRow {
  id: number;
  productId: number;
  entryDate: string; // "YYYY-MM-DD", keyed this way for simplicity - both
  // services here only ever use a single shift ("NIGHT"), so date alone is
  // enough to order "the immediately preceding day".
  remainingStock: number;
  [key: string]: unknown;
}

function makeStatefulStockRepository() {
  const rows: FakeRow[] = [];

  function dateKey(d: Date): string {
    return d.toISOString().slice(0, 10);
  }

  return {
    rows,
    findByProductAndDate: vi.fn(async (productId: number, entryDate: Date, _shift: string) => {
      const key = dateKey(entryDate);
      return rows.find((r) => r.productId === productId && r.entryDate === key) ?? null;
    }),
    getOpeningStock: vi.fn(async (productId: number, entryDate: Date, _shift: string) => {
      const key = dateKey(entryDate);
      const prior = rows
        .filter((r) => r.productId === productId && r.entryDate < key)
        .sort((a, b) => b.entryDate.localeCompare(a.entryDate))[0];
      return prior ? Number(prior.remainingStock) : 0;
    }),
    upsert: vi.fn(async (id: number | undefined, data: Record<string, unknown>) => {
      const key = dateKey(data.entryDate as Date);
      if (id !== undefined) {
        const row = rows.find((r) => r.id === id)!;
        Object.assign(row, data, { entryDate: key });
        return row;
      }
      const row: FakeRow = { id: rows.length + 1, productId: data.productId as number, entryDate: key, remainingStock: 0, ...data };
      row.entryDate = key;
      rows.push(row);
      return row;
    }),
  };
}

const { offlineRepo, onlineRepo } = vi.hoisted(() => ({
  offlineRepo: makeStatefulStockRepository(),
  onlineRepo: makeStatefulStockRepository(),
}));

vi.mock("../repositories/dailyOfflineStockRepository", () => ({ dailyOfflineStockRepository: offlineRepo }));
vi.mock("../repositories/dailyOnlineStockRepository", () => ({ dailyOnlineStockRepository: onlineRepo }));
vi.mock("../repositories/productRepository", () => ({
  productRepository: { findActiveById: vi.fn(async (id: number) => ({ id, name: `Product #${id}` })) },
}));
vi.mock("../repositories/deliveryDestinationRepository", () => ({ deliveryDestinationRepository: { findByIds: vi.fn() } }));
vi.mock("../repositories/offlineEntryDeliveryRepository", () => ({
  offlineEntryDeliveryRepository: { findByEntryId: vi.fn().mockResolvedValue([]), upsert: vi.fn() },
}));
vi.mock("./changeLog.service", () => ({ recordChange: vi.fn() }));

import { saveOfflineEntry } from "./dailyOfflineStock.service";
import { saveOnlineEntry } from "./dailyOnlineStock.service";

const PRODUCT_ID = 1;
const SHIFT = "NIGHT" as const;
const DAY1 = new Date("2026-06-01T00:00:00.000Z");
const DAY2 = new Date("2026-06-02T00:00:00.000Z");
const DAY3 = new Date("2026-06-03T00:00:00.000Z");

beforeEach(() => {
  offlineRepo.rows.length = 0;
  onlineRepo.rows.length = 0;
  vi.clearAllMocks();
});

describe("Offline - Remaining Stock carries forward as the next day's Opening Stock", () => {
  it("carries forward correctly across three consecutive days with no drift", async () => {
    // Day 1: nothing to carry forward from - opening defaults to 0.
    const day1 = await saveOfflineEntry(PRODUCT_ID, DAY1, SHIFT, { productionIn: 100, deliveryOut: 20 });
    expect(Number(day1.openingStock)).toBe(0);
    expect(Number(day1.remainingStock)).toBe(80); // 0 + 100 - 20

    // Day 2: opening must be exactly day 1's remaining stock (80).
    const day2 = await saveOfflineEntry(PRODUCT_ID, DAY2, SHIFT, { productionIn: 50, deliveryOut: 30 });
    expect(Number(day2.openingStock)).toBe(80);
    expect(Number(day2.remainingStock)).toBe(100); // 80 + 50 - 30

    // Day 3: opening must be exactly day 2's remaining stock (100) - proves
    // this isn't just "day N reads day 1" by coincidence, but a real
    // rolling chain.
    const day3 = await saveOfflineEntry(PRODUCT_ID, DAY3, SHIFT, { productionIn: 10, backloads: 5 });
    expect(Number(day3.openingStock)).toBe(100);
    expect(Number(day3.remainingStock)).toBe(115); // 100 + 10 - 0 + 5
  });

  it("editing an earlier day's figures after the fact does NOT retroactively ripple into a later day already saved", async () => {
    // This pins down the actual (documented) carry-forward contract: opening
    // stock is captured once, at save time, from whatever the prior day's
    // remainingStock was then - not a live formula re-evaluated later. Later
    // days aren't re-derived automatically if an earlier one is corrected.
    await saveOfflineEntry(PRODUCT_ID, DAY1, SHIFT, { productionIn: 100, deliveryOut: 20 });
    const day2 = await saveOfflineEntry(PRODUCT_ID, DAY2, SHIFT, { productionIn: 0, deliveryOut: 0 });
    expect(Number(day2.openingStock)).toBe(80);

    // Correcting day 1 afterward...
    await saveOfflineEntry(PRODUCT_ID, DAY1, SHIFT, { productionIn: 200, deliveryOut: 20 });

    // ...leaves day 2's already-saved openingStock exactly as it was.
    const day2Again = await offlineRepo.findByProductAndDate(PRODUCT_ID, DAY2, SHIFT);
    expect(Number(day2Again?.openingStock)).toBe(80);
  });
});

describe("Online - Remaining Stock carries forward as the next day's Opening Stock", () => {
  it("carries forward correctly across three consecutive days with no drift", async () => {
    const day1 = await saveOnlineEntry(PRODUCT_ID, DAY1, SHIFT, { productionIn: 60, fulfillmentOut: 10 });
    expect(Number(day1.openingStock)).toBe(0);
    expect(Number(day1.remainingStock)).toBe(50); // 0 + 60 - 10

    const day2 = await saveOnlineEntry(PRODUCT_ID, DAY2, SHIFT, { productionIn: 20, fulfillmentOut: 5, rts: 2 });
    expect(Number(day2.openingStock)).toBe(50);
    expect(Number(day2.remainingStock)).toBe(67); // 50 + 20 - 5 + 2

    const day3 = await saveOnlineEntry(PRODUCT_ID, DAY3, SHIFT, { fulfillmentOut: 7 });
    expect(Number(day3.openingStock)).toBe(67);
    expect(Number(day3.remainingStock)).toBe(60); // 67 + 0 - 7
  });
});
