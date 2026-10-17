import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Morning and Night of the same date are two periods in one chain: Night opens
 * with the same day's Morning remaining stock. carryForward.test.ts keys its
 * doubles by date alone, so it cannot see this boundary - correcting a Morning
 * row has to re-derive that day's already-saved Night row, not only later days.
 */

type Shift = "MORNING" | "NIGHT";

interface FakeRow {
  id: number;
  productId: number;
  entryDate: string;
  shift: Shift;
  remainingStock: number;
  [key: string]: unknown;
}

function makeShiftAwareRepository() {
  const rows: FakeRow[] = [];
  const dateKey = (d: Date) => d.toISOString().slice(0, 10);
  // Chronological position: Morning < Night within a date.
  const order = (r: { entryDate: string; shift: Shift }) => `${r.entryDate}:${r.shift === "MORNING" ? 0 : 1}`;
  const widen = (r: FakeRow) => ({ ...r, entryDate: new Date(`${r.entryDate}T00:00:00.000Z`) });

  return {
    rows,
    findByProductAndDate: vi.fn(async (productId: number, entryDate: Date, shift: Shift) => {
      const found = rows.find((r) => r.productId === productId && r.entryDate === dateKey(entryDate) && r.shift === shift);
      return found ? widen(found) : null;
    }),
    findNext: vi.fn(async (productId: number, entryDate: Date, shift: Shift) => {
      const after = order({ entryDate: dateKey(entryDate), shift });
      const next = rows.filter((r) => r.productId === productId && order(r) > after).sort((a, b) => order(a).localeCompare(order(b)))[0];
      return next ? widen(next) : null;
    }),
    getOpeningStock: vi.fn(async (productId: number, entryDate: Date, shift: Shift) => {
      const before = order({ entryDate: dateKey(entryDate), shift });
      const prior = rows.filter((r) => r.productId === productId && order(r) < before).sort((a, b) => order(b).localeCompare(order(a)))[0];
      return prior ? Number(prior.remainingStock) : 0;
    }),
    upsert: vi.fn(async (id: number | undefined, data: Record<string, unknown>) => {
      const key = dateKey(data.entryDate as Date);
      if (id !== undefined) {
        const row = rows.find((r) => r.id === id)!;
        Object.assign(row, data, { entryDate: key });
        return widen(row);
      }
      const row = { id: rows.length + 1, remainingStock: 0, ...data, entryDate: key } as FakeRow;
      rows.push(row);
      return widen(row);
    }),
  };
}

vi.mock("../repositories/dailyOfflineStockRepository", () => ({ dailyOfflineStockRepository: makeShiftAwareRepository() }));
vi.mock("../repositories/dailyOnlineStockRepository", () => ({ dailyOnlineStockRepository: makeShiftAwareRepository() }));
vi.mock("../lib/prisma", () => ({
  prisma: { $transaction: (cb: (tx: unknown) => unknown) => cb({}) },
  serializableTransaction: (cb: (tx: unknown) => unknown) => cb({}),
}));
vi.mock("../repositories/productRepository", () => ({
  productRepository: { findActiveById: vi.fn(async (id: number) => ({ id, name: `Product #${id}` })) },
}));
vi.mock("../repositories/manualCountRepository", () => ({
  manualCountRepository: { findOne: vi.fn(async () => null), upsert: vi.fn() },
}));
const { isLockedForCarry, holdStaleOpening } = vi.hoisted(() => ({
  isLockedForCarry: vi.fn(async (_date: Date) => false),
  holdStaleOpening: vi.fn(async () => undefined),
}));
vi.mock("./dayLock.service", () => ({
  assertPeriodOpen: vi.fn(),
  assertEarlierDaysFinished: vi.fn(),
  isCounterpartLocked: vi.fn().mockResolvedValue(false),
  isLockedForCarry,
}));
vi.mock("./staleOpening.service", () => ({ holdStaleOpening }));
vi.mock("./changeLog.service", () => ({ recordChange: vi.fn() }));

import { dailyOfflineStockRepository } from "../repositories/dailyOfflineStockRepository";
import { dailyOnlineStockRepository } from "../repositories/dailyOnlineStockRepository";
import { previousPeriod } from "../utils/shift";
import { saveOfflineEntry } from "./dailyOfflineStock.service";
import { saveOnlineEntry } from "./dailyOnlineStock.service";
import { propagateOpeningStock } from "./manualCounts.service";

const PRODUCT_ID = 1;
const DAY = new Date("2026-06-01T00:00:00.000Z");
const NEXT_DAY = new Date("2026-06-02T00:00:00.000Z");

beforeEach(() => {
  (dailyOnlineStockRepository as unknown as { rows: FakeRow[] }).rows.length = 0;
  (dailyOfflineStockRepository as unknown as { rows: FakeRow[] }).rows.length = 0;
  vi.clearAllMocks();
  isLockedForCarry.mockResolvedValue(false);
});

describe("Morning -> Night carry-forward on the same date", () => {
  it("Online: correcting Morning re-derives the already-saved Night opening and every period after it", async () => {
    await saveOnlineEntry(PRODUCT_ID, DAY, "MORNING", { productionIn: 100, fulfillmentOut: 20 }); // remaining 80
    const night = await saveOnlineEntry(PRODUCT_ID, DAY, "NIGHT", { fulfillmentOut: 10 });
    expect(Number(night.openingStock)).toBe(80);
    await saveOnlineEntry(PRODUCT_ID, NEXT_DAY, "MORNING", { fulfillmentOut: 5 });

    // Late correction to the Morning shift: remaining 80 -> 180.
    await saveOnlineEntry(PRODUCT_ID, DAY, "MORNING", { productionIn: 200, fulfillmentOut: 20 });

    const nightAgain = await dailyOnlineStockRepository.findByProductAndDate(PRODUCT_ID, DAY, "NIGHT");
    expect(Number(nightAgain?.openingStock)).toBe(180);
    expect(Number(nightAgain?.remainingStock)).toBe(170); // 180 - 10

    const morningAfter = await dailyOnlineStockRepository.findByProductAndDate(PRODUCT_ID, NEXT_DAY, "MORNING");
    expect(Number(morningAfter?.openingStock)).toBe(170);
    expect(Number(morningAfter?.remainingStock)).toBe(165); // 170 - 5
  });

  it("Offline: correcting Morning re-derives the already-saved Night opening", async () => {
    await saveOfflineEntry(PRODUCT_ID, DAY, "MORNING", { productionIn: 100, deliveryOut: 20 }); // remaining 80
    const night = await saveOfflineEntry(PRODUCT_ID, DAY, "NIGHT", { deliveryOut: 10 });
    expect(Number(night.openingStock)).toBe(80);

    await saveOfflineEntry(PRODUCT_ID, DAY, "MORNING", { productionIn: 200, deliveryOut: 20 });

    const nightAgain = await dailyOfflineStockRepository.findByProductAndDate(PRODUCT_ID, DAY, "NIGHT");
    expect(Number(nightAgain?.openingStock)).toBe(180);
    expect(Number(nightAgain?.remainingStock)).toBe(170);
  });

  it("a Night correction still only moves later days, never the same day's Morning", async () => {
    const morning = await saveOnlineEntry(PRODUCT_ID, DAY, "MORNING", { productionIn: 100 });
    await saveOnlineEntry(PRODUCT_ID, DAY, "NIGHT", { fulfillmentOut: 10 });
    await saveOnlineEntry(PRODUCT_ID, DAY, "NIGHT", { fulfillmentOut: 30 });
    const morningAgain = await dailyOnlineStockRepository.findByProductAndDate(PRODUCT_ID, DAY, "MORNING");
    expect(Number(morningAgain?.openingStock)).toBe(Number(morning.openingStock));
    expect(Number(morningAgain?.remainingStock)).toBe(100);
  });
});

describe("carry-forward into a finished day", () => {
  const DAY3 = new Date("2026-06-03T00:00:00.000Z");

  it("does not rewrite the finished day, does not fail the save, and files a held request instead", async () => {
    await saveOnlineEntry(PRODUCT_ID, DAY, "NIGHT", { productionIn: 100, fulfillmentOut: 20 }); // remaining 80
    await saveOnlineEntry(PRODUCT_ID, NEXT_DAY, "NIGHT", { fulfillmentOut: 5 }); // opens 80, remaining 75
    await saveOnlineEntry(PRODUCT_ID, DAY3, "NIGHT", { fulfillmentOut: 5 }); // opens 75, remaining 70

    // NEXT_DAY is now finished.
    isLockedForCarry.mockImplementation(async (date: Date) => date.getTime() === NEXT_DAY.getTime());

    const saved = await saveOnlineEntry(PRODUCT_ID, DAY, "NIGHT", { productionIn: 200, fulfillmentOut: 20 }); // remaining 180
    expect(Number(saved.remainingStock)).toBe(180); // the edit itself went through

    const locked = await dailyOnlineStockRepository.findByProductAndDate(PRODUCT_ID, NEXT_DAY, "NIGHT");
    expect(Number(locked?.openingStock)).toBe(80); // untouched
    expect(holdStaleOpening).toHaveBeenCalledTimes(1);
    const [location, row, proposedOpening] = holdStaleOpening.mock.calls[0] as unknown as [string, { id: number }, number];
    expect([location, row.id, proposedOpening]).toEqual(["ONLINE", locked?.id, 180]);

    // The walk stopped at the finished day, so the day after it is untouched too.
    const after = await dailyOnlineStockRepository.findByProductAndDate(PRODUCT_ID, DAY3, "NIGHT");
    expect(Number(after?.openingStock)).toBe(75);
  });

  it("an approved row is written even though its period is finished, and the walk after it holds again", async () => {
    await saveOnlineEntry(PRODUCT_ID, DAY, "NIGHT", { productionIn: 100, fulfillmentOut: 20 });
    await saveOnlineEntry(PRODUCT_ID, NEXT_DAY, "NIGHT", { fulfillmentOut: 5 });
    await saveOnlineEntry(PRODUCT_ID, DAY3, "NIGHT", { fulfillmentOut: 5 });
    isLockedForCarry.mockResolvedValue(true); // every later day is finished

    const approved = await dailyOnlineStockRepository.findByProductAndDate(PRODUCT_ID, NEXT_DAY, "NIGHT");
    // Make the stored opening stale, as a held request would find it.
    await dailyOnlineStockRepository.upsert(approved!.id, { ...approved, openingStock: 1 } as never);

    const outcome = await propagateOpeningStock(PRODUCT_ID, DAY, "NIGHT", "ONLINE", undefined, {} as never, undefined, {
      from: previousPeriod(NEXT_DAY, "NIGHT"),
      approvedRowId: approved!.id,
    });

    const rewritten = await dailyOnlineStockRepository.findByProductAndDate(PRODUCT_ID, NEXT_DAY, "NIGHT");
    expect(Number(rewritten?.openingStock)).toBe(80); // re-derived from DAY's remaining
    // Day 3's opening (75) is now behind NEXT_DAY's remaining (75)... unchanged, so the walk ends cleanly.
    expect(outcome).toBeUndefined();
  });
});
