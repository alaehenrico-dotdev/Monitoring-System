import { beforeEach, describe, expect, it, vi } from "vitest";

const prismaMock = vi.hoisted(() => ({ product: { findMany: vi.fn(), create: vi.fn(), update: vi.fn() } }));
vi.mock("../lib/prisma", () => ({
  prisma: prismaMock,
  serializableTransaction: (fn: (tx: unknown) => unknown) => fn(prismaMock),
}));
vi.mock("../lib/realtime", () => ({ broadcastRealtimeEvent: vi.fn() }));
vi.mock("../repositories/productRepository", () => ({ productRepository: { invalidateCache: vi.fn() } }));
const logSystemEvent = vi.hoisted(() => vi.fn());
vi.mock("./changeLog.service", () => ({ recordChange: vi.fn(), logSystemEvent }));
const mergeProductInto = vi.hoisted(() => vi.fn());
vi.mock("./productMerge.service", () => ({ mergeProductInto }));

import { syncProductsFromSheet } from "./productSync.service";

const p = (id: number, name: string, category: string, sortOrder: number) => ({ id, name, category, sortOrder, unit: "Liter", isActive: true });

beforeEach(() => {
  vi.clearAllMocks();
  prismaMock.product.update.mockImplementation(async ({ where, data }: { where: { id: number }; data: Record<string, unknown> }) => ({ id: where.id, ...data }));
  mergeProductInto.mockImplementation(async (_tx: unknown, fromId: number, intoId: number) => ({
    from: { id: fromId, name: "PALM OIL" }, into: { id: intoId, name: "Palm Oil Liter" }, moved: { online: 3, offline: 0, extras: 0, counts: 1 }, droppedBlank: 0,
  }));
});

describe("syncProductsFromSheet - merging a duplicate into the product it is the same as", () => {
  it("merges first, then orders the list without the merged-away product", async () => {
    // The list is read after the merge, so it no longer holds product 5.
    prismaMock.product.findMany.mockImplementation(async () => {
      expect(mergeProductInto).toHaveBeenCalled();
      return [p(2, "Palm Oil Liter", "New Products", 2), p(3, "Sweet A", "Class A", 3)];
    });

    const out = await syncProductsFromSheet(
      [{ category: "Class A", name: "PALM OIL", productId: 2, mergeFromId: 5 }, { category: "Class A", name: "Sweet A", productId: 3 }],
      7,
    );

    expect(mergeProductInto).toHaveBeenCalledWith(prismaMock, 5, 2, 7);
    expect(out.merged).toBe(1);
    // The surviving product keeps its own name (no rename) and takes the sheet's category.
    expect(prismaMock.product.update).toHaveBeenCalledWith({ where: { id: 2 }, data: { category: "Class A" } });
    expect(logSystemEvent).toHaveBeenCalledWith("product_sync", expect.objectContaining({ merged: [expect.objectContaining({ from: "PALM OIL", into: "Palm Oil Liter" })] }), 7, "UPDATE");
  });

  it("rejects a merge with no product to merge into, before changing anything", async () => {
    await expect(syncProductsFromSheet([{ category: "Class A", name: "PALM OIL", mergeFromId: 5 }])).rejects.toMatchObject({ status: 400 });
    expect(mergeProductInto).not.toHaveBeenCalled();
    expect(prismaMock.product.findMany).not.toHaveBeenCalled();
  });

  it("rejects a product that is merged away and also a row of the sheet", async () => {
    await expect(
      syncProductsFromSheet([{ category: "A", name: "X", productId: 2, mergeFromId: 5 }, { category: "A", name: "Y", productId: 5 }]),
    ).rejects.toMatchObject({ status: 400 });
    expect(mergeProductInto).not.toHaveBeenCalled();
  });
});
