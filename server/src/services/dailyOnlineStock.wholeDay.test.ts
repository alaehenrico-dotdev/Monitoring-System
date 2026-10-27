import { beforeEach, describe, expect, it, vi } from "vitest";

// Only the database layer is mocked; the combining and the added-column maths run for real.
const mocks = vi.hoisted(() => ({
  findActive: vi.fn(),
  findAllForDate: vi.fn(),
  getOpeningStocksForProducts: vi.fn(),
  extraFindAll: vi.fn(),
  layoutFind: vi.fn(),
  getEntryRules: vi.fn(),
}));
vi.mock("../lib/prisma", () => ({ prisma: {}, serializableTransaction: vi.fn() }));
vi.mock("../repositories/productRepository", () => ({ productRepository: { findActive: mocks.findActive } }));
vi.mock("../repositories/dailyOnlineStockRepository", () => ({
  dailyOnlineStockRepository: { findAllForDate: mocks.findAllForDate, getOpeningStocksForProducts: mocks.getOpeningStocksForProducts },
}));
vi.mock("../repositories/dailyOfflineStockRepository", () => ({ dailyOfflineStockRepository: {} }));
vi.mock("../repositories/dailyStockExtraRepository", () => ({ dailyStockExtraRepository: { findAllForDate: mocks.extraFindAll } }));
vi.mock("../repositories/sheetExtraColumnRepository", () => ({ sheetExtraColumnRepository: { findForSheet: mocks.layoutFind } }));
vi.mock("./appSettings.service", () => ({ getEntryRules: mocks.getEntryRules }));
vi.mock("./changeLog.service", () => ({ recordChange: vi.fn() }));
vi.mock("./dayLock.service", () => ({ assertPeriodOpen: vi.fn(), assertEarlierDaysFinished: vi.fn() }));
vi.mock("./heldTransfers.service", () => ({ holdLockedTransfers: vi.fn(), requestHeldTransfers: vi.fn() }));
vi.mock("../lib/realtime", () => ({ broadcastRealtimeEvent: vi.fn() }));
vi.mock("./manualCounts.service", () => ({ propagateOpeningStock: vi.fn() }));

import { getOnlineGrid } from "./dailyOnlineStock.service";

const DAY = new Date("2026-10-23T00:00:00Z");
const alpha = { id: 1, name: "Alpha", sku: "A1", category: "Class A" };

const row = (shift: "MORNING" | "NIGHT", over: Record<string, number> = {}) => ({
  productId: 1,
  entryDate: DAY,
  shift,
  openingStock: 0,
  stockInOffToOl: 0,
  stockOutOlToOff: 0,
  productionIn: 0,
  fulfillmentOut: 0,
  rts: 0,
  onlineStock: 0,
  remainingStock: 0,
  ...over,
});

// Added Fulfillment (Out) columns are stored amounts, not columns on the row.
const extra = (shift: "MORNING" | "NIGHT", slotIndex: number, amount: number) => ({ productId: 1, shift, columnKey: "fulfillmentOut", slotIndex, amount });

// Morning: opens 50, +20 production, fulfils 30 (slot 1 = 30), closes 40.
// Night:   opens 40, +10 production, fulfils 25 (slot 1 = 10, slot 2 = 15), closes 25.
const MORNING = row("MORNING", { openingStock: 50, onlineStock: 50, productionIn: 20, fulfillmentOut: 30, remainingStock: 40 });
const NIGHT = row("NIGHT", { openingStock: 40, onlineStock: 40, productionIn: 10, fulfillmentOut: 25, remainingStock: 25 });
const entry = (grid: Awaited<ReturnType<typeof getOnlineGrid>>) => grid[0].entry as Record<string, unknown>;

beforeEach(() => {
  vi.clearAllMocks();
  mocks.findActive.mockResolvedValue([alpha]);
  mocks.getOpeningStocksForProducts.mockResolvedValue(new Map());
  mocks.layoutFind.mockResolvedValue([]);
  mocks.getEntryRules.mockResolvedValue({ useShifts: true });
  mocks.findAllForDate.mockImplementation(async (_date: Date, shift: string) => (shift === "MORNING" ? [MORNING] : [NIGHT]));
  mocks.extraFindAll.mockImplementation(async (_loc: string, _date: Date, shift: string) =>
    shift === "MORNING" ? [extra("MORNING", 1, 30)] : [extra("NIGHT", 1, 10), extra("NIGHT", 2, 15)],
  );
});

describe('getOnlineGrid with combineSplitDay: "always"', () => {
  it("adds the two sheets together: Morning's opening, both shifts' movements, the day's closing", async () => {
    const e = entry(await getOnlineGrid(DAY, "NIGHT", { combineSplitDay: "always" }));
    expect(e.openingStock).toBe(50);
    expect(e.productionIn).toBe(30); // 20 + 10
    expect(e.fulfillmentOut).toBe(55); // 30 + 25
    expect(e.remainingStock).toBe(25); // 50 + 30 - 55, the Night sheet's own recorded closing
  });

  it("adds each added column across both shifts", async () => {
    const e = entry(await getOnlineGrid(DAY, "NIGHT", { combineSplitDay: "always" }));
    expect(e.fulfillmentOut__x1).toBe(40); // 30 + 10
    expect(e.fulfillmentOut__x2).toBe(15); // only the Night sheet has slot 2
    expect((e.fulfillmentOut__x1 as number) + (e.fulfillmentOut__x2 as number)).toBe(e.fulfillmentOut);
  });

  it("combines whichever way the shifts setting is set", async () => {
    for (const useShifts of [true, false]) {
      mocks.getEntryRules.mockResolvedValue({ useShifts });
      const e = entry(await getOnlineGrid(DAY, "NIGHT", { combineSplitDay: "always" }));
      expect([useShifts, e.fulfillmentOut]).toEqual([useShifts, 55]);
    }
  });

  it("the default with shifts ON is still the Night sheet as entered", async () => {
    const e = entry(await getOnlineGrid(DAY, "NIGHT"));
    expect(e.fulfillmentOut).toBe(25);
    expect(e.openingStock).toBe(40);
  });
});
