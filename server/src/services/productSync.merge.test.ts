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

describe("syncProductsFromSheet - hiding products the sheet does not list", () => {
  const sheet = [{ category: "Class A", name: "Sweet A", productId: 2 }];
  const listed = p(2, "SWEET A", "Class A", 2);

  beforeEach(() => {
    prismaMock.product.findMany.mockResolvedValue([listed, p(3, "SWEET CHAMI", "Class A", 3), { ...p(4, "OLD", "Other", 4), isActive: false }]);
  });

  it("switches off every active product the sheet does not list - never deleting - and logs each", async () => {
    const out = await syncProductsFromSheet(sheet, 7, { deactivateUnlisted: true });

    expect(out.deactivated).toBe(1);
    expect(prismaMock.product.update).toHaveBeenCalledWith({ where: { id: 3 }, data: { isActive: false } });
    // The listed product and the one that was already off are left alone.
    expect(prismaMock.product.update).not.toHaveBeenCalledWith({ where: { id: 2 }, data: { isActive: false } });
    expect(prismaMock.product.update).not.toHaveBeenCalledWith({ where: { id: 4 }, data: { isActive: false } });
    expect(logSystemEvent).toHaveBeenCalledWith("product_sync", expect.objectContaining({ deactivated: ["SWEET CHAMI"] }), 7, "UPDATE");
  });

  it("leaves them active when not asked to (the default)", async () => {
    const out = await syncProductsFromSheet(sheet, 7);

    expect(out.deactivated).toBe(0);
    expect(prismaMock.product.update).not.toHaveBeenCalledWith({ where: { id: 3 }, data: { isActive: false } });
  });

  it("stores names uppercase, including for a product it creates", async () => {
    prismaMock.product.create.mockImplementation(async ({ data }: { data: Record<string, unknown> }) => ({ id: 50, ...data }));
    prismaMock.product.findMany.mockResolvedValue([listed]);

    await syncProductsFromSheet([{ category: "Class A", name: "  Fish   sauce " }]);

    expect(prismaMock.product.create).toHaveBeenCalledWith({ data: expect.objectContaining({ name: "FISH SAUCE" }) });
  });
});

describe("syncProductsFromSheet - products the sheet does not list keep their category", () => {
  it("places each right after the last product of its category, and at the end when the sheet has none of that category", async () => {
    // Sheet: B, A (category X) then Cx (Y). Unlisted: Ux (X) and Uz (Z, not in the sheet at all).
    prismaMock.product.findMany.mockResolvedValue([
      p(1, "A", "X", 1), p(2, "CX", "Y", 2), p(3, "B", "X", 3), p(4, "UX", "X", 4), p(5, "UZ", "Z", 5),
    ]);

    await syncProductsFromSheet([
      { category: "X", name: "B", productId: 3 },
      { category: "X", name: "A", productId: 1 },
      { category: "Y", name: "CX", productId: 2 },
    ]);

    const order = Object.fromEntries(prismaMock.product.update.mock.calls.flatMap((c) => (c[0].data.sortOrder ? [[c[0].where.id, c[0].data.sortOrder]] : [])));
    // B, A, then UX beside its category X, then CX, and UZ (category Z) last. UZ already was 5th.
    expect(order).toEqual({ 3: 1, 1: 2, 4: 3, 2: 4 });
  });
});

