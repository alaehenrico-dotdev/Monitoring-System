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
vi.mock("../repositories/dailyOfflineStockRepository", () => ({
  dailyOfflineStockRepository: { findAllForDate: mocks.findAllForDate, getOpeningStocksForProducts: mocks.getOpeningStocksForProducts },
}));
vi.mock("../repositories/dailyOnlineStockRepository", () => ({ dailyOnlineStockRepository: {} }));
vi.mock("../repositories/dailyStockExtraRepository", () => ({ dailyStockExtraRepository: { findAllForDate: mocks.extraFindAll } }));
vi.mock("../repositories/sheetExtraColumnRepository", () => ({ sheetExtraColumnRepository: { findForSheet: mocks.layoutFind } }));
vi.mock("./appSettings.service", () => ({ getEntryRules: mocks.getEntryRules }));
vi.mock("./changeLog.service", () => ({ recordChange: vi.fn() }));
vi.mock("./dayLock.service", () => ({ assertPeriodOpen: vi.fn(), assertEarlierDaysFinished: vi.fn() }));
vi.mock("./heldTransfers.service", () => ({ holdLockedTransfers: vi.fn(), requestHeldTransfers: vi.fn() }));
vi.mock("../lib/realtime", () => ({ broadcastRealtimeEvent: vi.fn() }));
vi.mock("./manualCounts.service", () => ({ propagateOpeningStock: vi.fn() }));

import { getOfflineGrid } from "./dailyOfflineStock.service";

const DAY = new Date("2026-10-23T00:00:00Z");
const alpha = { id: 1, name: "Alpha", sku: "A1", category: "Class A" };
const beta = { id: 2, name: "Beta", sku: "B2", category: "Class A" };

// A stored sheet row. Delivery (Out)'s first five added columns are its delivery1..5 slots.
const row = (productId: number, shift: "MORNING" | "NIGHT", over: Record<string, number> = {}) => ({
  productId,
  entryDate: DAY,
  shift,
  openingStock: 0,
  stockInOlToOff: 0,
  stockOutOffToOl: 0,
  productionIn: 0,
  deliveryOut: 0,
  delivery1: 0,
  delivery2: 0,
  delivery3: 0,
  delivery4: 0,
  delivery5: 0,
  backloads: 0,
  upsellOut: 0,
  offlineStock: 0,
  remainingStock: 0,
  ...over,
});

const sheets = (morning: ReturnType<typeof row>[], night: ReturnType<typeof row>[]) =>
  mocks.findAllForDate.mockImplementation(async (_date: Date, shift: string) => (shift === "MORNING" ? morning : night));

beforeEach(() => {
  vi.clearAllMocks();
  mocks.findActive.mockResolvedValue([alpha, beta]);
  mocks.getOpeningStocksForProducts.mockResolvedValue(new Map());
  mocks.extraFindAll.mockResolvedValue([]);
  mocks.layoutFind.mockResolvedValue([]);
  mocks.getEntryRules.mockResolvedValue({ useShifts: true });
});

// Morning: opens 100, delivers 30 (slot 1 = 10, slot 2 = 20), closes 70.
// Night:   opens 70,  delivers 25 (slot 1 = 5,  slot 2 = 20), closes 45.
const MORNING = row(1, "MORNING", { openingStock: 100, offlineStock: 100, deliveryOut: 30, delivery1: 10, delivery2: 20, remainingStock: 70 });
const NIGHT = row(1, "NIGHT", { openingStock: 70, offlineStock: 70, deliveryOut: 25, delivery1: 5, delivery2: 20, remainingStock: 45 });
const entryOf = (grid: Awaited<ReturnType<typeof getOfflineGrid>>, id = 1) => grid.find((r) => r.product.id === id)!.entry as Record<string, unknown>;

describe('getOfflineGrid with combineSplitDay: "always"', () => {
  it("adds the day's two sheets together: Morning's opening, both shifts' movements, the closing of the day", async () => {
    sheets([MORNING], [NIGHT]);
    const e = entryOf(await getOfflineGrid(DAY, "NIGHT", { combineSplitDay: "always" }));
    expect(e.openingStock).toBe(100);
    expect(e.deliveryOut).toBe(55); // 30 + 25
    expect(e.remainingStock).toBe(45); // 100 - 55, the Night sheet's own recorded closing
  });

  it("adds each added column across both shifts, so none of the Morning amounts is lost", async () => {
    sheets([MORNING], [NIGHT]);
    const e = entryOf(await getOfflineGrid(DAY, "NIGHT", { combineSplitDay: "always" }));
    expect(e.deliveryOut__x1).toBe(15); // 10 + 5
    expect(e.deliveryOut__x2).toBe(40); // 20 + 20
    expect((e.deliveryOut__x1 as number) + (e.deliveryOut__x2 as number)).toBe(e.deliveryOut); // the total is the sum of them
  });

  it("combines whichever way the shifts setting is set - the report must not depend on it", async () => {
    for (const useShifts of [true, false]) {
      mocks.getEntryRules.mockResolvedValue({ useShifts });
      sheets([MORNING], [NIGHT]);
      const e = entryOf(await getOfflineGrid(DAY, "NIGHT", { combineSplitDay: "always" }));
      expect([useShifts, e.deliveryOut]).toEqual([useShifts, 55]);
    }
  });

  it("a product with only a Morning sheet is that sheet", async () => {
    sheets([MORNING], []);
    const e = entryOf(await getOfflineGrid(DAY, "NIGHT", { combineSplitDay: "always" }));
    expect(e.openingStock).toBe(100);
    expect(e.deliveryOut).toBe(30);
    expect(e.remainingStock).toBe(70);
    expect(e.deliveryOut__x2).toBe(20);
  });

  it("a day with only a Night sheet (shifts off, or no Morning entry) is unchanged", async () => {
    sheets([], [NIGHT]);
    const e = entryOf(await getOfflineGrid(DAY, "NIGHT", { combineSplitDay: "always" }));
    expect(e.openingStock).toBe(70);
    expect(e.deliveryOut).toBe(25);
    expect(e.remainingStock).toBe(45);
  });

  it("a product with no sheet at all still appears, unsaved", async () => {
    sheets([MORNING], [NIGHT]);
    const grid = await getOfflineGrid(DAY, "NIGHT", { combineSplitDay: "always" });
    expect(grid).toHaveLength(2);
    expect(grid.find((r) => r.product.id === 2)!.isSaved).toBe(false);
    expect(grid.find((r) => r.product.id === 1)!.isSaved).toBe(true);
  });
});

describe("the other modes are unchanged", () => {
  it("default, shifts ON: the Night sheet as entered (not combined)", async () => {
    sheets([MORNING], [NIGHT]);
    const e = entryOf(await getOfflineGrid(DAY, "NIGHT"));
    expect(e.deliveryOut).toBe(25);
    expect(e.openingStock).toBe(70);
  });

  it("default, shifts OFF: the whole-day view, as before", async () => {
    mocks.getEntryRules.mockResolvedValue({ useShifts: false });
    sheets([MORNING], [NIGHT]);
    const e = entryOf(await getOfflineGrid(DAY, "NIGHT"));
    expect(e.deliveryOut).toBe(55);
    expect(e.wholeDayCombined).toBe(true);
  });

  it("combineSplitDay: false, shifts OFF: still the sheet's own rows", async () => {
    mocks.getEntryRules.mockResolvedValue({ useShifts: false });
    sheets([MORNING], [NIGHT]);
    const e = entryOf(await getOfflineGrid(DAY, "NIGHT", { combineSplitDay: false }));
    expect(e.deliveryOut).toBe(25);
  });

  it("the Morning grid is never combined", async () => {
    sheets([MORNING], [NIGHT]);
    const e = entryOf(await getOfflineGrid(DAY, "MORNING", { combineSplitDay: "always" }));
    expect(e.deliveryOut).toBe(30);
  });
});
