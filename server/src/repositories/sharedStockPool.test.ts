import { beforeEach, describe, expect, it, vi } from "vitest";
import { findSharedStockPartnerId, poolSharedRows, resetSharedStockCache } from "./sharedStockPool";

vi.mock("../lib/prisma", () => ({ prisma: {} }));

const DATE = new Date("2026-11-27T00:00:00.000Z");

type Row = Record<string, unknown>;

function fakeDb(online: Row[], offline: Row[], products = [{ id: 52 }, { id: 53 }]) {
  const update = (rows: Row[]) =>
    vi.fn().mockImplementation(({ where, data }) => Promise.resolve({ ...rows.find((r) => r.id === where.id), ...data }));
  return {
    product: { findMany: vi.fn().mockResolvedValue(products) },
    dailyOnlineStock: { findMany: vi.fn().mockResolvedValue(online), create: vi.fn().mockResolvedValue({}), update: update(online) },
    dailyOfflineStock: { findMany: vi.fn().mockResolvedValue(offline), create: vi.fn().mockResolvedValue({}), update: update(offline) },
  };
}
const asDb = (d: ReturnType<typeof fakeDb>) => d as never;

const base = { entryDate: DATE, shift: "NIGHT" as const, encodedById: 9 };
// Offline Liter, saved with a delivery of 4 against an opening of 11.
const saved = { ...base, id: 31, productId: 52, openingStock: 11, offlineStock: 11, deliveryOut: 4, productionIn: 0, backloads: 0, upsellOut: 0, remainingStock: 7 };

beforeEach(resetSharedStockCache);

describe("findSharedStockPartnerId", () => {
  it("looks the pair up once, not on every write", async () => {
    const db = fakeDb([], []);
    await findSharedStockPartnerId(53, asDb(db));
    await findSharedStockPartnerId(52, asDb(db));
    expect(db.product.findMany).toHaveBeenCalledTimes(1);
  });
  it("returns the other palm oil product", async () => {
    expect(await findSharedStockPartnerId(53, asDb(fakeDb([], [])))).toBe(52);
    resetSharedStockCache();
    expect(await findSharedStockPartnerId(52, asDb(fakeDb([], [])))).toBe(53);
  });
  it("returns null for any other product, or when the pair is incomplete", async () => {
    expect(await findSharedStockPartnerId(7, asDb(fakeDb([], [])))).toBeNull();
    resetSharedStockCache();
    expect(await findSharedStockPartnerId(53, asDb(fakeDb([], [], [{ id: 53 }])))).toBeNull();
  });
});

describe("poolSharedRows", () => {
  it("creates the three missing rows of the pool on the pooled figures, so Online is no longer blank", async () => {
    const db = fakeDb([], [saved]);
    const result = await poolSharedRows(saved, "OFFLINE", 53, asDb(db));

    // Online Liter, Online Gallon and Offline Gallon did not exist: each opens at 11 and shows the pool's 7.
    expect(db.dailyOnlineStock.create).toHaveBeenCalledTimes(2);
    expect(db.dailyOnlineStock.create).toHaveBeenCalledWith({ data: expect.objectContaining({ productId: 52, openingStock: 11, onlineStock: 11, remainingStock: 7, encodedById: 9 }) });
    expect(db.dailyOnlineStock.create).toHaveBeenCalledWith({ data: expect.objectContaining({ productId: 53, openingStock: 11, onlineStock: 11, remainingStock: 7 }) });
    expect(db.dailyOfflineStock.create).toHaveBeenCalledTimes(1);
    expect(db.dailyOfflineStock.create).toHaveBeenCalledWith({ data: expect.objectContaining({ productId: 53, offlineStock: 11, remainingStock: 7 }) });
    expect(result.remainingStock).toBe(7);
  });

  it("counts every row's movements, Online and Offline, in the one remaining stock", async () => {
    const onlineGallon = { ...base, id: 11, productId: 53, openingStock: 11, onlineStock: 11, remainingStock: 11, fulfillmentOut: 3, productionIn: 0, rts: 0 };
    const db = fakeDb([onlineGallon], [saved]);
    const result = await poolSharedRows(saved, "OFFLINE", 53, asDb(db));

    // 11 - 3 (Online Gallon fulfillment) - 4 (Offline Liter delivery) = 4
    expect(db.dailyOnlineStock.update).toHaveBeenCalledWith({ where: { id: 11 }, data: { openingStock: 11, onlineStock: 11, remainingStock: 4 } });
    expect(result.remainingStock).toBe(4);
  });

  it("writes nothing extra when all four rows already hold the pooled figures", async () => {
    const mk = (id: number, productId: number): Row => ({ ...base, id, productId, openingStock: 11, onlineStock: 11, offlineStock: 11, remainingStock: 7, fulfillmentOut: 0, productionIn: 0, rts: 0, deliveryOut: productId === 52 ? 4 : 0, backloads: 0, upsellOut: 0 });
    const offLiter = mk(31, 52);
    const db = fakeDb([mk(11, 52), mk(12, 53)], [offLiter, mk(32, 53)]);
    const result = await poolSharedRows(offLiter as typeof saved, "OFFLINE", 53, asDb(db));

    expect(db.dailyOnlineStock.create).not.toHaveBeenCalled();
    expect(db.dailyOfflineStock.create).not.toHaveBeenCalled();
    expect(db.dailyOnlineStock.update).not.toHaveBeenCalled();
    expect(db.dailyOfflineStock.update).not.toHaveBeenCalled();
    expect(result).toBe(offLiter);
  });
});
