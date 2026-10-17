import { beforeEach, describe, expect, it, vi } from "vitest";

const recordChange = vi.hoisted(() => vi.fn());
vi.mock("./changeLog.service", () => ({ recordChange }));

import { mergeProductInto } from "./productMerge.service";

const D = (day: string) => new Date(`${day}T00:00:00.000Z`);
const product = (id: number, name: string, sku: string | null) => ({ id, name, sku, category: "Class A", unit: "Liter", isActive: true, sortOrder: id });
const online = (id: number, day: string, shift: "MORNING" | "NIGHT", figures: Record<string, number> = {}) => ({
  id, entryDate: D(day), shift, openingStock: 0, stockInOffToOl: 0, stockOutOlToOff: 0, onlineStock: 0, productionIn: 0, fulfillmentOut: 0, rts: 0, remainingStock: 0, ...figures,
});

function fakeTx(data: {
  products?: ReturnType<typeof product>[];
  fromOnline?: unknown[]; intoOnline?: unknown[];
  fromOffline?: unknown[]; intoOffline?: unknown[];
  fromCounts?: unknown[]; intoCounts?: unknown[];
  fromExtras?: unknown[]; intoExtras?: unknown[];
}) {
  const pick = (from: unknown[] = [], into: unknown[] = []) =>
    vi.fn(async ({ where }: { where: { productId: number } }) => (where.productId === 1 ? from : into));
  const update = () => vi.fn(async ({ where }: { where: { productId: number } }) => ({ count: where.productId === 1 ? 2 : 0 }));
  return {
    product: {
      findUnique: vi.fn(async ({ where }: { where: { id: number } }) => (data.products ?? []).find((p) => p.id === where.id) ?? null),
      delete: vi.fn(async () => ({})),
    },
    dailyOnlineStock: { findMany: pick(data.fromOnline, data.intoOnline), deleteMany: vi.fn(async () => ({})), updateMany: update() },
    dailyOfflineStock: { findMany: pick(data.fromOffline, data.intoOffline), deleteMany: vi.fn(async () => ({})), updateMany: update() },
    manualCount: { findMany: pick(data.fromCounts, data.intoCounts), updateMany: update() },
    dailyStockExtra: { findMany: pick(data.fromExtras, data.intoExtras), updateMany: update() },
    pendingRelease: { updateMany: update() },
  };
}

const NEW = product(1, "PALM OIL", null);
const ORIGINAL = product(2, "Palm Oil Liter", "AFP069");

beforeEach(() => vi.clearAllMocks());

describe("mergeProductInto", () => {
  it("moves every entry, count and added column onto the other product and deletes the duplicate", async () => {
    const tx = fakeTx({ products: [NEW, ORIGINAL], fromOnline: [online(10, "2026-10-12", "MORNING", { stockInOffToOl: 5 })] });

    const out = await mergeProductInto(tx as never, 1, 2, 7);

    for (const table of [tx.dailyOnlineStock, tx.dailyOfflineStock, tx.manualCount, tx.dailyStockExtra, tx.pendingRelease]) {
      expect(table.updateMany).toHaveBeenCalledWith({ where: { productId: 1 }, data: { productId: 2 } });
    }
    expect(tx.product.delete).toHaveBeenCalledWith({ where: { id: 1 } });
    expect(out.moved).toEqual({ online: 2, offline: 2, extras: 2, counts: 2, pendingReleases: 2 });
    expect(recordChange).toHaveBeenCalledWith(expect.objectContaining({ tableName: "products", recordId: 1, action: "DELETE", changedById: 7 }), tx);
  });

  it("moves awaiting-release items before deleting the duplicate, so the delete is not blocked by them", async () => {
    const tx = fakeTx({ products: [NEW, ORIGINAL] });
    const order: string[] = [];
    tx.pendingRelease.updateMany.mockImplementation(async () => {
      order.push("pending-moved");
      return { count: 3 };
    });
    tx.product.delete.mockImplementation(async () => {
      order.push("product-deleted");
      return {};
    });

    const out = await mergeProductInto(tx as never, 1, 2);

    expect(order).toEqual(["pending-moved", "product-deleted"]);
    expect(out.moved.pendingReleases).toBe(3);
  });

  it("stops and changes nothing when both products have entries for the same period", async () => {
    const tx = fakeTx({
      products: [NEW, ORIGINAL],
      fromOnline: [online(10, "2026-10-12", "MORNING", { stockInOffToOl: 5 })],
      intoOnline: [{ entryDate: D("2026-10-12"), shift: "MORNING" }],
    });

    await expect(mergeProductInto(tx as never, 1, 2)).rejects.toMatchObject({
      status: 409,
      message: expect.stringContaining("Online 2026-10-12 Morning"),
    });
    expect(tx.dailyOnlineStock.updateMany).not.toHaveBeenCalled();
    expect(tx.product.delete).not.toHaveBeenCalled();
  });

  it("drops an empty row of the duplicate instead of calling it a clash", async () => {
    const tx = fakeTx({
      products: [NEW, ORIGINAL],
      fromOnline: [online(10, "2026-10-12", "MORNING")],
      intoOnline: [{ entryDate: D("2026-10-12"), shift: "MORNING" }],
    });

    const out = await mergeProductInto(tx as never, 1, 2);

    expect(tx.dailyOnlineStock.deleteMany).toHaveBeenCalledWith({ where: { id: { in: [10] } } });
    expect(out.droppedBlank).toBe(1);
    expect(tx.product.delete).toHaveBeenCalled();
  });

  it("treats counts for the same location and period as a clash", async () => {
    const key = { entryDate: D("2026-10-12"), shift: "NIGHT", location: "ONLINE" };
    const tx = fakeTx({ products: [NEW, ORIGINAL], fromCounts: [key], intoCounts: [key] });

    await expect(mergeProductInto(tx as never, 1, 2)).rejects.toMatchObject({ status: 409, message: expect.stringContaining("Count (ONLINE 2026-10-12 Night)") });
  });

  it("lists at most a few clashes, with how many more there are", async () => {
    const rows = Array.from({ length: 12 }, (_, i) => online(100 + i, `2026-10-${String(i + 1).padStart(2, "0")}`, "MORNING", { stockInOffToOl: 1 }));
    const tx = fakeTx({ products: [NEW, ORIGINAL], fromOnline: rows, intoOnline: rows.map((r) => ({ entryDate: r.entryDate, shift: r.shift })) });

    await expect(mergeProductInto(tx as never, 1, 2)).rejects.toMatchObject({ message: expect.stringContaining("(and 4 more)") });
  });

  it("refuses to merge away a product that has a SKU", async () => {
    const tx = fakeTx({ products: [product(1, "Sweet A", "AFP001"), ORIGINAL] });

    await expect(mergeProductInto(tx as never, 1, 2)).rejects.toMatchObject({ status: 400, message: expect.stringContaining("AFP001") });
    expect(tx.product.delete).not.toHaveBeenCalled();
  });

  it("refuses to merge a product into itself, or into one that does not exist", async () => {
    const tx = fakeTx({ products: [NEW] });
    await expect(mergeProductInto(tx as never, 1, 1)).rejects.toMatchObject({ status: 400 });
    await expect(mergeProductInto(tx as never, 1, 99)).rejects.toMatchObject({ status: 400, message: "Unknown product id 99" });
  });
});
