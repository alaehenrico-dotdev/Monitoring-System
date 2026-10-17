import { beforeEach, describe, expect, it, vi } from "vitest";

const txMock = vi.hoisted(() => ({
  pendingRelease: { create: vi.fn(), findUnique: vi.fn(), update: vi.fn() },
}));
vi.mock("../lib/prisma", () => ({
  prisma: { $transaction: (cb: (tx: unknown) => unknown) => cb(txMock) },
  serializableTransaction: (cb: (tx: unknown) => unknown) => cb(txMock),
}));
vi.mock("../lib/realtime", () => ({ broadcastRealtimeEvent: vi.fn() }));
vi.mock("./changeLog.service", () => ({ recordChange: vi.fn() }));
const productRepo = vi.hoisted(() => ({ findActiveById: vi.fn() }));
vi.mock("../repositories/productRepository", () => ({ productRepository: productRepo }));
const onlineRepo = vi.hoisted(() => ({ findByProductAndDate: vi.fn() }));
const offlineRepo = vi.hoisted(() => ({ findByProductAndDate: vi.fn() }));
vi.mock("../repositories/dailyOnlineStockRepository", () => ({ dailyOnlineStockRepository: onlineRepo }));
vi.mock("../repositories/dailyOfflineStockRepository", () => ({ dailyOfflineStockRepository: offlineRepo }));
const extrasRepo = vi.hoisted(() => ({ findForProduct: vi.fn() }));
vi.mock("../repositories/dailyStockExtraRepository", () => ({ dailyStockExtraRepository: extrasRepo }));
const saveOnlineEntry = vi.hoisted(() => vi.fn());
const saveOfflineEntry = vi.hoisted(() => vi.fn());
vi.mock("./dailyOnlineStock.service", () => ({ saveOnlineEntry }));
vi.mock("./dailyOfflineStock.service", () => ({ saveOfflineEntry }));

import { cancelPendingRelease, createPendingRelease, releasePendingRelease, updatePendingRelease } from "./pendingRelease.service";

const D = (iso: string) => new Date(`${iso}T00:00:00.000Z`);
const NOW = new Date("2026-10-17T03:00:00.000Z");
const awaitingItem = (over: Record<string, unknown> = {}) => ({
  id: 5,
  location: "OFFLINE",
  productId: 11,
  quantity: "24",
  madeDate: D("2026-10-15"),
  madeShift: "NIGHT",
  status: "AWAITING",
  ...over,
});

beforeEach(() => {
  vi.clearAllMocks();
  extrasRepo.findForProduct.mockResolvedValue([]);
  offlineRepo.findByProductAndDate.mockResolvedValue(null);
  onlineRepo.findByProductAndDate.mockResolvedValue(null);
  txMock.pendingRelease.update.mockImplementation(async ({ data }: { data: object }) => ({ id: 5, ...data }));
});

describe("createPendingRelease", () => {
  const base = { location: "OFFLINE" as const, productId: 11, quantity: 24, madeDate: D("2026-10-16"), madeShift: "NIGHT" as const, reason: "No sticker yet" };

  it("records an item for an active product", async () => {
    productRepo.findActiveById.mockResolvedValue({ id: 11, name: "SPECIAL" });
    txMock.pendingRelease.create.mockResolvedValue({ id: 1, ...base });
    await createPendingRelease(base, 3, NOW);
    expect(txMock.pendingRelease.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ productId: 11, quantity: 24, createdById: 3 }) }));
  });

  it.each([0, -1, 0.001, 100_000_000])("rejects a quantity of %s", async (quantity) => {
    await expect(createPendingRelease({ ...base, quantity }, 3, NOW)).rejects.toMatchObject({ status: 400 });
    expect(txMock.pendingRelease.create).not.toHaveBeenCalled();
  });

  it("rejects a made date in the future and an unknown product", async () => {
    await expect(createPendingRelease({ ...base, madeDate: D("2026-10-30") }, 3, NOW)).rejects.toMatchObject({ status: 400 });
    productRepo.findActiveById.mockResolvedValue(null);
    await expect(createPendingRelease(base, 3, NOW)).rejects.toMatchObject({ status: 404 });
  });
});

describe("releasePendingRelease", () => {
  const target = { entryDate: D("2026-10-17"), shift: "MORNING" as const };

  it("adds the quantity to the existing Production (In) and marks the item released, in one transaction", async () => {
    txMock.pendingRelease.findUnique.mockResolvedValue(awaitingItem());
    offlineRepo.findByProductAndDate.mockResolvedValue({ productionIn: "100" });
    const result = await releasePendingRelease(5, target, "Labelled", 7, NOW);

    expect(saveOfflineEntry).toHaveBeenCalledWith(11, target.entryDate, "MORNING", { productionIn: 124 }, 7, txMock);
    expect(saveOnlineEntry).not.toHaveBeenCalled();
    expect(result).toMatchObject({ status: "RELEASED", releasedById: 7, releasedShift: "MORNING", resolutionNote: "Labelled" });
  });

  it("releases an Online item through the Online save", async () => {
    txMock.pendingRelease.findUnique.mockResolvedValue(awaitingItem({ location: "ONLINE", quantity: "10.5" }));
    onlineRepo.findByProductAndDate.mockResolvedValue({ productionIn: "0.7" });
    await releasePendingRelease(5, target, undefined, 7, NOW);
    expect(saveOnlineEntry).toHaveBeenCalledWith(11, target.entryDate, "MORNING", { productionIn: 11.2 }, 7, txMock);
  });

  it("adds one more individual amount when the cell already has +1 columns, keeping total and parts in step", async () => {
    txMock.pendingRelease.findUnique.mockResolvedValue(awaitingItem());
    extrasRepo.findForProduct.mockResolvedValue([
      { columnKey: "productionIn", slotIndex: 1, amount: "60" },
      { columnKey: "productionIn", slotIndex: 3, amount: "40" },
      { columnKey: "fulfillmentOut", slotIndex: 1, amount: "9" },
    ]);
    await releasePendingRelease(5, target, undefined, 7, NOW);
    expect(saveOfflineEntry).toHaveBeenCalledWith(
      11,
      target.entryDate,
      "MORNING",
      {
        extras: [
          { columnKey: "productionIn", slotIndex: 1, amount: 60 },
          { columnKey: "productionIn", slotIndex: 3, amount: 40 },
          { columnKey: "productionIn", slotIndex: 4, amount: 24 },
        ],
      },
      7,
      txMock,
    );
  });

  it("never back-dates: refuses a period more than a day away from today", async () => {
    await expect(releasePendingRelease(5, { entryDate: D("2026-10-12"), shift: "NIGHT" }, undefined, 7, NOW)).rejects.toMatchObject({
      status: 400,
      message: expect.stringContaining("Back-dating"),
    });
    expect(saveOfflineEntry).not.toHaveBeenCalled();
    expect(txMock.pendingRelease.update).not.toHaveBeenCalled();
  });

  it("refuses a release dated before the goods were made", async () => {
    txMock.pendingRelease.findUnique.mockResolvedValue(awaitingItem({ madeDate: D("2026-10-18") }));
    await expect(releasePendingRelease(5, target, undefined, 7, NOW)).rejects.toMatchObject({ status: 400 });
  });

  it("refuses an item that is already released or cancelled", async () => {
    txMock.pendingRelease.findUnique.mockResolvedValue(awaitingItem({ status: "RELEASED" }));
    await expect(releasePendingRelease(5, target, undefined, 7, NOW)).rejects.toMatchObject({ status: 409 });
    expect(saveOfflineEntry).not.toHaveBeenCalled();
  });

  it("does not mark the item released if the entry save is refused (finished period)", async () => {
    txMock.pendingRelease.findUnique.mockResolvedValue(awaitingItem());
    saveOfflineEntry.mockRejectedValueOnce(Object.assign(new Error("finished and locked"), { status: 409 }));
    await expect(releasePendingRelease(5, target, undefined, 7, NOW)).rejects.toMatchObject({ status: 409 });
    expect(txMock.pendingRelease.update).not.toHaveBeenCalled();
  });

  it("refuses an unknown item", async () => {
    txMock.pendingRelease.findUnique.mockResolvedValue(null);
    await expect(releasePendingRelease(99, target, undefined, 7, NOW)).rejects.toMatchObject({ status: 404 });
  });
});

describe("cancel and edit", () => {
  it("cancels only an awaiting item and keeps the reason", async () => {
    txMock.pendingRelease.findUnique.mockResolvedValue(awaitingItem());
    const cancelled = await cancelPendingRelease(5, "Spoiled in storage", 2);
    expect(cancelled).toMatchObject({ status: "CANCELLED", resolutionNote: "Spoiled in storage" });

    txMock.pendingRelease.findUnique.mockResolvedValue(awaitingItem({ status: "CANCELLED" }));
    await expect(cancelPendingRelease(5, "again", 2)).rejects.toMatchObject({ status: 409 });
  });

  it("edits quantity and reason of an awaiting item, with the same quantity rules", async () => {
    txMock.pendingRelease.findUnique.mockResolvedValue(awaitingItem());
    await updatePendingRelease(5, { quantity: 30 }, 2);
    expect(txMock.pendingRelease.update).toHaveBeenCalledWith({ where: { id: 5 }, data: { quantity: 30, reason: undefined } });
    await expect(updatePendingRelease(5, { quantity: -3 }, 2)).rejects.toMatchObject({ status: 400 });
  });
});
