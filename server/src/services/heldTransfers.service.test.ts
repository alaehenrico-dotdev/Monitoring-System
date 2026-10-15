import { beforeEach, describe, expect, it, vi } from "vitest";

const isCounterpartLocked = vi.hoisted(() => vi.fn());
vi.mock("./dayLock.service", () => ({ isCounterpartLocked }));
const recordChange = vi.hoisted(() => vi.fn());
vi.mock("./changeLog.service", () => ({ recordChange }));

import { holdLockedTransfers, requestHeldTransfers } from "./heldTransfers.service";

const DATE = new Date("2026-10-14T00:00:00.000Z");
const db = {
  correctionRequest: { findFirst: vi.fn(), create: vi.fn(), update: vi.fn() },
} as never as Parameters<typeof holdLockedTransfers>[5] & {
  correctionRequest: { findFirst: ReturnType<typeof vi.fn>; create: ReturnType<typeof vi.fn>; update: ReturnType<typeof vi.fn> };
};

beforeEach(() => {
  vi.clearAllMocks();
  isCounterpartLocked.mockResolvedValue(true);
});

describe("holdLockedTransfers", () => {
  const existing = { stockInOffToOl: 5, stockOutOlToOff: 0, fulfillmentOut: 2 };

  it("holds a changed transfer when the other page is finished, and lets everything else through", async () => {
    const { input, held } = await holdLockedTransfers("ONLINE", { stockInOffToOl: 9, fulfillmentOut: 4 }, existing, DATE, "NIGHT", db);
    expect(held).toEqual([{ field: "stockInOffToOl", before: 5, proposed: 9 }]);
    expect(input).not.toHaveProperty("stockInOffToOl");
    expect(input).toMatchObject({ fulfillmentOut: 4 });
  });

  it("drops the held column's added amounts too, so its total cannot sneak through", async () => {
    const { input, held } = await holdLockedTransfers(
      "ONLINE",
      { extras: [{ columnKey: "stockInOffToOl", slotIndex: 1, amount: 8 }, { columnKey: "rts", slotIndex: 1, amount: 1 }], clearExtraColumns: ["stockInOffToOl"] },
      existing,
      DATE,
      "NIGHT",
      db,
    );
    expect(held).toEqual([{ field: "stockInOffToOl", before: 5, proposed: 8 }]);
    expect((input as { extras?: unknown }).extras).toEqual([{ columnKey: "rts", slotIndex: 1, amount: 1 }]);
    expect((input as { clearExtraColumns?: unknown }).clearExtraColumns).toEqual([]);
  });

  it("holds the Offline page's transfer fields when Online is finished", async () => {
    const { held } = await holdLockedTransfers("OFFLINE", { stockOutOffToOl: 3 }, { stockOutOffToOl: 0 }, DATE, "NIGHT", db);
    expect(held).toEqual([{ field: "stockOutOffToOl", before: 0, proposed: 3 }]);
    expect(isCounterpartLocked).toHaveBeenCalledWith(DATE, "NIGHT", "OFFLINE", db);
  });

  it("holds nothing when the other page is still open", async () => {
    isCounterpartLocked.mockResolvedValue(false);
    const input = { stockInOffToOl: 9 };
    const result = await holdLockedTransfers("ONLINE", input, existing, DATE, "NIGHT", db);
    expect(result).toEqual({ input, held: [] });
  });

  it("holds nothing when the transfer figure is unchanged, without even looking at the lock", async () => {
    const result = await holdLockedTransfers("ONLINE", { stockInOffToOl: 5, fulfillmentOut: 7 }, existing, DATE, "NIGHT", db);
    expect(result.held).toEqual([]);
    expect(isCounterpartLocked).not.toHaveBeenCalled();
  });

  it("treats a missing row as zero", async () => {
    const { held } = await holdLockedTransfers("ONLINE", { stockOutOlToOff: 2 }, null, DATE, "NIGHT", db);
    expect(held).toEqual([{ field: "stockOutOlToOff", before: 0, proposed: 2 }]);
  });
});

describe("requestHeldTransfers", () => {
  const held = [{ field: "stockInOffToOl", before: 5, proposed: 9 }];

  it("files a pending request against the saved row and logs it", async () => {
    db.correctionRequest.findFirst.mockResolvedValue(null);
    db.correctionRequest.create.mockResolvedValue({ id: 31 });
    await requestHeldTransfers("ONLINE", 12, held, 7, db);
    expect(db.correctionRequest.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        tableName: "daily_online_stock",
        recordId: 12,
        field: "stockInOffToOl",
        beforeValue: "5",
        proposedValue: "9",
        requestedById: 7,
        reason: expect.stringContaining("Offline is already finished"),
      }),
    });
    expect(recordChange).toHaveBeenCalledWith(expect.objectContaining({ tableName: "correction_requests", recordId: 31, action: "CREATE" }), db);
  });

  it("updates the pending request for the same figure instead of stacking another", async () => {
    db.correctionRequest.findFirst.mockResolvedValue({ id: 31 });
    db.correctionRequest.update.mockResolvedValue({ id: 31 });
    await requestHeldTransfers("ONLINE", 12, [{ field: "stockInOffToOl", before: 5, proposed: 11 }], 7, db);
    expect(db.correctionRequest.create).not.toHaveBeenCalled();
    expect(db.correctionRequest.update).toHaveBeenCalledWith({
      where: { id: 31 },
      data: expect.objectContaining({ proposedValue: "11", beforeValue: "5" }),
    });
  });
});
