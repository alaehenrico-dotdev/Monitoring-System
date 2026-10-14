import { beforeEach, describe, expect, it, vi } from "vitest";

const prismaMock = vi.hoisted(() => {
  const m = {
    product: { findMany: vi.fn(), create: vi.fn(), update: vi.fn() },
    $transaction: vi.fn(),
  };
  m.$transaction.mockImplementation(async (fn: (tx: unknown) => unknown) => fn(m));
  return m;
});
vi.mock("../lib/prisma", () => ({
  prisma: prismaMock,
  serializableTransaction: (fn: (tx: unknown) => unknown) => fn(prismaMock),
}));
vi.mock("../lib/realtime", () => ({ broadcastRealtimeEvent: vi.fn() }));
vi.mock("../repositories/productRepository", () => ({ productRepository: { invalidateCache: vi.fn() } }));
const recordChange = vi.hoisted(() => vi.fn());
const logSystemEvent = vi.hoisted(() => vi.fn());
vi.mock("./changeLog.service", () => ({ recordChange, logSystemEvent }));

import { syncProductsFromSheet } from "./productSync.service";

const p = (id: number, name: string, category: string, sortOrder: number, unit = "Liter", isActive = true) => ({ id, name, category, sortOrder, unit, isActive });

describe("syncProductsFromSheet", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    let next = 100;
    prismaMock.product.create.mockImplementation(async ({ data }: { data: Record<string, unknown> }) => ({ id: next++, ...data }));
    prismaMock.product.update.mockImplementation(async ({ where, data }: { where: { id: number }; data: Record<string, unknown> }) => ({ id: where.id, ...data }));
  });

  it("creates a missing product without an SKU, in its category's unit, at the sheet's position", async () => {
    prismaMock.product.findMany.mockResolvedValue([p(1, "Sweet A", "Class A", 1, "Liter"), p(2, "Special A", "Class A", 2, "Liter")]);
    const out = await syncProductsFromSheet([
      { category: "Class A", name: "Sweet A" },
      { category: "CLASS A", name: "  NEW   ONE " },
      { category: "Class A", name: "Special A" },
    ]);
    expect(out).toMatchObject({ created: 1, moved: 0, total: 3 });
    const data = prismaMock.product.create.mock.calls[0][0].data;
    expect(data).toMatchObject({ name: "NEW ONE", unit: "Liter" });
    expect(data.sku).toBeUndefined();
    // New one is #2, Special A moves to #3.
    expect(prismaMock.product.update).toHaveBeenCalledWith({ where: { id: 100 }, data: { sortOrder: 2 } });
    expect(prismaMock.product.update).toHaveBeenCalledWith({ where: { id: 2 }, data: { sortOrder: 3 } });
  });

  it("uses '-' as the unit for a brand-new category", async () => {
    prismaMock.product.findMany.mockResolvedValue([]);
    await syncProductsFromSheet([{ category: "Other PRODUCTS", name: "Cassava" }]);
    expect(prismaMock.product.create.mock.calls[0][0].data.unit).toBe("-");
  });

  it("matches strictly: 'Sweet-A' is not 'Sweet A'", async () => {
    prismaMock.product.findMany.mockResolvedValue([p(1, "Sweet A", "Class A", 1)]);
    const out = await syncProductsFromSheet([{ category: "Class A", name: "Sweet-A" }]);
    expect(out.created).toBe(1);
  });

  it("applies the sheet's order, keeps unlisted products after it, and is a no-op when already in order", async () => {
    prismaMock.product.findMany.mockResolvedValue([p(1, "A", "X", 1), p(2, "B", "X", 2), p(3, "Unlisted", "Y", 3)]);
    const out = await syncProductsFromSheet([
      { category: "X", name: "B" },
      { category: "X", name: "A" },
    ]);
    expect(out.reordered).toBe(2);
    expect(prismaMock.product.update).toHaveBeenCalledWith({ where: { id: 2 }, data: { sortOrder: 1 } });
    expect(prismaMock.product.update).toHaveBeenCalledWith({ where: { id: 1 }, data: { sortOrder: 2 } });

    vi.clearAllMocks();
    prismaMock.product.findMany.mockResolvedValue([p(2, "B", "X", 1), p(1, "A", "X", 2), p(3, "Unlisted", "Y", 3)]);
    const again = await syncProductsFromSheet([
      { category: "X", name: "B" },
      { category: "X", name: "A" },
    ]);
    expect(again).toMatchObject({ created: 0, moved: 0, reordered: 0 });
    expect(prismaMock.product.update).not.toHaveBeenCalled();
    expect(logSystemEvent).not.toHaveBeenCalled();
  });

  it("moves a product the client resolved to another category, and logs it", async () => {
    prismaMock.product.findMany.mockResolvedValue([p(5, "NSC Toyomansi", "NSC", 1)]);
    const out = await syncProductsFromSheet([{ category: "Other PRODUCTS", name: "NSC TOYOMANSI", productId: 5 }], 9);
    expect(out.moved).toBe(1);
    expect(prismaMock.product.update).toHaveBeenCalledWith({ where: { id: 5 }, data: { category: "Other PRODUCTS" } });
    expect(recordChange).toHaveBeenCalledWith(expect.objectContaining({ action: "UPDATE", recordId: 5, changedById: 9 }), expect.anything());
  });

  it("renames a linked product to the sheet's spelling, keeping its id (and so its SKU)", async () => {
    prismaMock.product.findMany.mockResolvedValue([p(7, "Jampong Hot Chili Sauce", "Class A", 1)]);
    const out = await syncProductsFromSheet([{ category: "Class A", name: "JAMPONG CHILI HOT SAUCE", productId: 7, rename: true }]);
    expect(out).toMatchObject({ created: 0, renamed: 1 });
    expect(prismaMock.product.update).toHaveBeenCalledWith({ where: { id: 7 }, data: { name: "JAMPONG CHILI HOT SAUCE" } });
    expect(prismaMock.product.create).not.toHaveBeenCalled();
  });

  it("switches a retired product back on when the sheet lists it, instead of creating a duplicate", async () => {
    prismaMock.product.findMany.mockResolvedValue([p(3, "Cassava", "Other", 1, "-", false)]);
    const out = await syncProductsFromSheet([{ category: "Other", name: "CASSAVA" }]);
    expect(out).toMatchObject({ created: 0, reactivated: 1 });
    expect(prismaMock.product.update).toHaveBeenCalledWith({ where: { id: 3 }, data: { isActive: true } });
    expect(prismaMock.product.create).not.toHaveBeenCalled();
  });

  it("does not duplicate a row repeated in the sheet, and rejects an unknown product id", async () => {
    prismaMock.product.findMany.mockResolvedValue([]);
    const out = await syncProductsFromSheet([
      { category: "X", name: "New" },
      { category: "x", name: "new" },
    ]);
    expect(out).toMatchObject({ created: 1, total: 1 });
    await expect(syncProductsFromSheet([{ category: "X", name: "Y", productId: 999 }])).rejects.toThrow(/Unknown product id/);
  });
});
