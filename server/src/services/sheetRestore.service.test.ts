import { beforeEach, describe, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({
  getSheetStateAt: vi.fn(),
  onlineRows: vi.fn(),
  offlineRows: vi.fn(),
  layout: vi.fn(),
  findActive: vi.fn(),
  saveOnline: vi.fn(),
  saveOffline: vi.fn(),
  logSystemEvent: vi.fn(),
}));
vi.mock("./sheetHistory.service", () => ({ getSheetStateAt: m.getSheetStateAt }));
vi.mock("../repositories/productRepository", () => ({ productRepository: { findActive: m.findActive } }));
vi.mock("../repositories/sheetExtraColumnRepository", () => ({ sheetExtraColumnRepository: { findForSheet: m.layout } }));
vi.mock("./dailyOnlineStock.service", () => ({ saveOnlineEntry: m.saveOnline }));
vi.mock("./dailyOfflineStock.service", () => ({ saveOfflineEntry: m.saveOffline }));
vi.mock("./changeLog.service", () => ({ logSystemEvent: m.logSystemEvent }));
vi.mock("../lib/realtime", () => ({ broadcastRealtimeEvent: vi.fn() }));
// The transaction handle: the restore reads what the sheet holds NOW through it.
const tx = { dailyOnlineStock: { findMany: m.onlineRows }, dailyOfflineStock: { findMany: m.offlineRows } };
vi.mock("../lib/prisma", () => ({ serializableTransaction: (fn: (t: unknown) => unknown) => fn(tx) }));

import { restoreSheetVersion } from "./sheetRestore.service";

beforeEach(() => {
  vi.clearAllMocks();
  m.findActive.mockResolvedValue([7, 8, 9, 10, 11].map((id) => ({ id })));
  m.onlineRows.mockResolvedValue([]);
  m.offlineRows.mockResolvedValue([]);
  m.layout.mockResolvedValue([]);
  m.saveOnline.mockResolvedValue({});
  m.saveOffline.mockResolvedValue({});
});

const snap = (productId: number, extra: Record<string, unknown> = {}) => ({ productId, entryDate: "2026-10-19", shift: "NIGHT", ...extra });

describe("restoreSheetVersion", () => {
  it("refuses a version that is not on this sheet", async () => {
    m.getSheetStateAt.mockResolvedValue(null);
    await expect(restoreSheetVersion("online", "2026-10-19", "NIGHT", 99)).rejects.toThrow(/no longer exists/);
    expect(m.saveOnline).not.toHaveBeenCalled();
  });

  it("writes each product's old figures back through the normal save", async () => {
    m.getSheetStateAt.mockResolvedValue(new Map([[10, snap(7, { stockInOffToOl: "5.00", productionIn: "3.00", fulfillmentOut: "1.00" })]]));
    const r = await restoreSheetVersion("online", "2026-10-19", "NIGHT", 5, 42);
    expect(r).toEqual({ restored: 1, held: 0, skipped: 0 });
    expect(m.saveOnline).toHaveBeenCalledWith(
      7,
      new Date("2026-10-19T00:00:00.000Z"),
      "NIGHT",
      { stockInOffToOl: 5, stockOutOlToOff: 0, productionIn: 3, fulfillmentOut: 1, rts: 0, extras: [], clearExtraColumns: [] },
      42,
      tx,
    );
  });

  it("restores added-column amounts, padding every product with the sheet's slots", async () => {
    m.getSheetStateAt.mockResolvedValue(
      new Map([
        [10, snap(7, { deliveryOut: "9.00", deliveryOut__x1: 4, deliveryOut__x2: 5 })],
        [11, snap(8, { deliveryOut: "2.00", deliveryOut__x1: 2 })],
      ]),
    );
    await restoreSheetVersion("offline", "2026-10-19", "NIGHT", 5);
    const second = m.saveOffline.mock.calls.find((c) => c[0] === 8)![3];
    expect(second.extras).toEqual([
      { columnKey: "deliveryOut", slotIndex: 1, amount: 2 },
      { columnKey: "deliveryOut", slotIndex: 2, amount: 0 },
    ]);
  });

  it("drops columns the sheet has now but that version did not, and zeroes products that did not exist", async () => {
    m.getSheetStateAt.mockResolvedValue(new Map([[10, snap(7, { deliveryOut: "9.00" })]]));
    m.layout.mockResolvedValue([{ columnKey: "deliveryOut", slotIndex: 1 }, { columnKey: "backloads", slotIndex: 1 }]);
    m.offlineRows.mockResolvedValue([{ productId: 7, deliveryOut: 9 }, { productId: 8, deliveryOut: 3 }, { productId: 9, deliveryOut: 0 }]);
    await restoreSheetVersion("offline", "2026-10-19", "NIGHT", 5);
    const saved = m.saveOffline.mock.calls.map((c) => c[0]);
    // Product 9 has nothing to undo, so it is left alone; product 8 is set back to zero.
    expect(saved).toEqual([7, 8]);
    expect(m.saveOffline.mock.calls[0][3].clearExtraColumns).toEqual(["deliveryOut", "backloads"]);
    expect(m.saveOffline.mock.calls[1][3]).toMatchObject({ deliveryOut: 0, backloads: 0 });
  });

  it("counts transfers held for approval", async () => {
    m.getSheetStateAt.mockResolvedValue(new Map([[10, snap(7, { stockInOffToOl: "5.00" })]]));
    m.saveOnline.mockResolvedValue({ heldForApproval: [{ field: "stockInOffToOl" }] });
    expect(await restoreSheetVersion("online", "2026-10-19", "NIGHT", 5)).toEqual({ restored: 1, held: 1, skipped: 0 });
  });
});

describe("restoreSheetVersion - edge cases", () => {
  it("keeps a flat total for a product saved before the sheet's columns were split", async () => {
    // Product 7 was saved flat (10, no added-column amounts); product 8 later got a +1/+2 split.
    m.getSheetStateAt.mockResolvedValue(
      new Map([
        [10, snap(7, { fulfillmentOut: "10.00" })],
        [11, snap(8, { fulfillmentOut: "7.00", fulfillmentOut__x1: 4, fulfillmentOut__x2: 3 })],
      ]),
    );
    await restoreSheetVersion("online", "2026-10-19", "NIGHT", 5);
    const flat = m.saveOnline.mock.calls.find((c) => c[0] === 7)![3];
    // Without this the save would recompute its total from zeros and wipe the 10.
    expect(flat.extras).toEqual([
      { columnKey: "fulfillmentOut", slotIndex: 1, amount: 10 },
      { columnKey: "fulfillmentOut", slotIndex: 2, amount: 0 },
    ]);
  });

  it("leaves a deactivated product alone instead of failing the whole restore", async () => {
    m.getSheetStateAt.mockResolvedValue(new Map([[10, snap(7, { productionIn: "3.00" })], [11, snap(99, { productionIn: "4.00" })]]));
    const r = await restoreSheetVersion("online", "2026-10-19", "NIGHT", 5);
    expect(r).toEqual({ restored: 1, held: 0, skipped: 1 });
    expect(m.saveOnline.mock.calls.map((c) => c[0])).toEqual([7]);
  });
});
