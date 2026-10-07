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
    // Mirrors the real repository's findNext: the earliest saved row strictly
    // after the given period. These doubles key by date alone (single shift),
    // so "strictly after" is just the next-greatest date.
    findNext: vi.fn(async (productId: number, entryDate: Date, _shift: string) => {
      const key = dateKey(entryDate);
      const next = rows
        .filter((r) => r.productId === productId && r.entryDate > key)
        .sort((a, b) => a.entryDate.localeCompare(b.entryDate))[0];
      // The real repository hands back a row whose entryDate is a Date, and
      // the caller feeds that straight back into getOpeningStock/findNext/
      // upsert - so widen the internal string key back out to a Date here.
      return next ? { ...next, entryDate: new Date(`${next.entryDate}T00:00:00.000Z`) } : null;
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
// saveOfflineEntry/saveOnlineEntry now wrap themselves in prisma.$transaction
// (see their own doc comments) - the stateful repository doubles above don't
// care what `db`/`tx` they're called with, so the fake transaction client
// just needs to run the callback.
vi.mock("../lib/prisma", () => ({
  prisma: { $transaction: (cb: (tx: unknown) => unknown) => cb({}) },
  serializableTransaction: (cb: (tx: unknown) => unknown) => cb({}),
}));
vi.mock("../repositories/productRepository", () => ({
  productRepository: { findActiveById: vi.fn(async (id: number) => ({ id, name: `Product #${id}` })) },
}));
// These fixtures exercise pure system carry-forward - no physical counts are
// recorded, so propagateOpeningStock never finds one superseding a period.
vi.mock("../repositories/manualCountRepository", () => ({
  manualCountRepository: { findOne: vi.fn(async () => null), upsert: vi.fn() },
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

  it("editing an earlier day's figures after the fact DOES ripple into a later day already saved", async () => {
    // Pins down the carry-forward contract as of v1.5.1, where saveOffline/
    // OnlineEntry gained a propagateOpeningStock call: correcting an earlier
    // period re-derives the already-saved periods after it, so a late
    // correction doesn't leave the chain permanently out of step. (Until
    // v1.5.1 opening stock was captured once at save time and never
    // re-derived; this test asserted that older contract.)
    await saveOfflineEntry(PRODUCT_ID, DAY1, SHIFT, { productionIn: 100, deliveryOut: 20 });
    const day2 = await saveOfflineEntry(PRODUCT_ID, DAY2, SHIFT, { productionIn: 0, deliveryOut: 0 });
    expect(Number(day2.openingStock)).toBe(80);

    // Correcting day 1 afterward (remaining 100 - 20 -> 200 - 20 = 180)...
    await saveOfflineEntry(PRODUCT_ID, DAY1, SHIFT, { productionIn: 200, deliveryOut: 20 });

    // ...re-derives day 2's opening stock from the corrected balance, and
    // its own remaining stock follows (180 + 0 - 0).
    const day2Again = await offlineRepo.findByProductAndDate(PRODUCT_ID, DAY2, SHIFT);
    expect(Number(day2Again?.openingStock)).toBe(180);
    expect(Number(day2Again?.remainingStock)).toBe(180);
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
