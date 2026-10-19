import { beforeEach, describe, expect, it, vi } from "vitest";
import { HttpError } from "../utils/HttpError";

vi.mock("../repositories/productRepository", () => ({
  productRepository: {
    findAll: vi.fn(),
    nextSortOrder: vi.fn(),
    create: vi.fn(),
    findById: vi.fn(),
    findBySku: vi.fn(),
    countReferences: vi.fn(),
    delete: vi.fn(),
    update: vi.fn(),
    invalidateCache: vi.fn(),
  },
}));
vi.mock("./changeLog.service", () => ({
  recordChange: vi.fn(),
  logSystemEvent: vi.fn(),
}));
const tx = vi.hoisted(() => ({ product: { findMany: vi.fn(), create: vi.fn(), update: vi.fn() } }));
vi.mock("../lib/prisma", () => ({ prisma: {}, serializableTransaction: (fn: (t: unknown) => unknown) => fn(tx) }));
vi.mock("../lib/realtime", () => ({ broadcastRealtimeEvent: vi.fn() }));

import { productRepository } from "../repositories/productRepository";
import { recordChange } from "./changeLog.service";
import { createProduct, deactivateProduct, deleteProductPermanently, listProducts, updateProduct } from "./products.service";

beforeEach(() => {
  vi.clearAllMocks();
});

describe("listProducts", () => {
  it("delegates to the repository with the includeInactive flag", async () => {
    vi.mocked(productRepository.findAll).mockResolvedValue([]);
    await listProducts(true);
    expect(productRepository.findAll).toHaveBeenCalledWith(true);
  });
});

describe("createProduct", () => {
  const p = (id: number, name: string, category: string, sortOrder: number) => ({ id, name, category, sortOrder, unit: "Liter", sku: null });

  beforeEach(() => {
    // Prisma's update returns the whole row, so the fake keeps what was created.
    const rows = new Map<number, Record<string, unknown>>();
    let next = 100;
    tx.product.create.mockImplementation(async ({ data }: { data: Record<string, unknown> }) => {
      const row = { id: next++, ...data };
      rows.set(row.id, row);
      return row;
    });
    tx.product.update.mockImplementation(async ({ where, data }: { where: { id: number }; data: Record<string, unknown> }) => ({ ...rows.get(where.id), id: where.id, ...data }));
  });

  it("places the new product right after the last product of its category and moves the rest down", async () => {
    tx.product.findMany.mockResolvedValue([p(1, "Sweet A", "Class A", 1), p(2, "Special A", "Class A", 2), p(3, "Palm Oil", "Oils", 3), p(4, "Salt", "Other", 4)]);

    const result = await createProduct({ name: "More Sweet A", category: "Class A", unit: "Liter" }, 7);

    expect(result).toMatchObject({ id: 100, name: "MORE SWEET A", category: "Class A", sortOrder: 3 });
    // Everything after it moved down one place; what was before did not change.
    const moved = tx.product.update.mock.calls.map((c) => [c[0].where.id, c[0].data.sortOrder]);
    expect(moved).toEqual([[100, 3], [3, 4], [4, 5]]);
    expect(recordChange).toHaveBeenCalledWith(
      expect.objectContaining({ tableName: "products", recordId: 100, action: "CREATE", changedById: 7 }),
      tx,
    );
  });

  it("joins an existing category by its own spelling instead of starting a second group", async () => {
    tx.product.findMany.mockResolvedValue([p(1, "Sweet A", "Class A (Gallon)", 1), p(2, "Salt", "Other", 2)]);

    const result = await createProduct({ name: "Dark A", category: "  class a   (GALLON) ", unit: "Gallon" });

    expect(result.category).toBe("Class A (Gallon)");
    expect(tx.product.create).toHaveBeenCalledWith({ data: expect.objectContaining({ category: "Class A (Gallon)" }) });
    expect(result.sortOrder).toBe(2);
  });

  it("stores the name in uppercase with single spaces, however it was typed", async () => {
    tx.product.findMany.mockResolvedValue([]);

    const result = await createProduct({ name: "  sweet   chami ", category: "Class A", unit: "Liter" });

    expect(result.name).toBe("SWEET CHAMI");
  });

  it("puts a product of a brand-new category at the very end, with its name tidied", async () => {
    tx.product.findMany.mockResolvedValue([p(1, "Sweet A", "Class A", 1), p(2, "Salt", "Other", 2)]);

    const result = await createProduct({ name: "Chili Oil", category: "New   Category", unit: "Bottle" });

    expect(result).toMatchObject({ category: "New Category", sortOrder: 3 });
    // Nothing else had to move.
    expect(tx.product.update).not.toHaveBeenCalled();
  });

  it("keeps an explicit sort order as given, without moving anything", async () => {
    const created = { id: 1, name: "Sweet A", category: "Class A", unit: "Liter", sortOrder: 9 };
    vi.mocked(productRepository.create).mockResolvedValue(created as never);

    const result = await createProduct({ name: "Sweet A", category: "Class A", unit: "Liter", sortOrder: 9 }, 7);

    expect(productRepository.create).toHaveBeenCalledWith(expect.objectContaining({ sortOrder: 9 }));
    expect(tx.product.findMany).not.toHaveBeenCalled();
    expect(result).toBe(created);
  });
});

describe("updateProduct", () => {
  it("throws HttpError.notFound when the product doesn't exist", async () => {
    vi.mocked(productRepository.findById).mockResolvedValue(null);

    await expect(updateProduct(999, { name: "New name" }, 7)).rejects.toThrow(HttpError);
    expect(productRepository.update).not.toHaveBeenCalled();
  });

  it("updates an existing product and records the change with old/new values", async () => {
    const existing = { id: 1, name: "Old name", category: "Class A", unit: "Liter", sortOrder: 1 };
    const updated = { ...existing, name: "New name" };
    vi.mocked(productRepository.findById).mockResolvedValue(existing as never);
    vi.mocked(productRepository.update).mockResolvedValue(updated as never);

    const result = await updateProduct(1, { name: "New name" }, 7);

    expect(productRepository.update).toHaveBeenCalledWith(1, { name: "NEW NAME" }); // names are stored in uppercase
    expect(recordChange).toHaveBeenCalledWith(
      expect.objectContaining({ action: "UPDATE", oldValue: existing, newValue: updated }),
    );
    expect(result).toBe(updated);
  });
});

describe("updateProduct - SKU code", () => {
  const existing = { id: 1, sku: "AFP007", name: "SWEET A", category: "Class A", unit: "Liter", sortOrder: 1 };
  beforeEach(() => {
    vi.mocked(productRepository.findById).mockResolvedValue(existing as never);
    vi.mocked(productRepository.update).mockImplementation((async (_id: number, d: object) => ({ ...existing, ...d })) as never);
    vi.mocked(productRepository.findBySku).mockResolvedValue(null);
  });

  it("changes the SKU code, trimmed, and records it", async () => {
    const result = await updateProduct(1, { sku: "  AFP-007 " }, 7);
    expect(productRepository.update).toHaveBeenCalledWith(1, { sku: "AFP-007" });
    expect(result.sku).toBe("AFP-007");
    expect(recordChange).toHaveBeenCalledWith(expect.objectContaining({ action: "UPDATE", oldValue: existing }));
  });

  it("clears the SKU when it is blank", async () => {
    await updateProduct(1, { sku: "   " }, 7);
    expect(productRepository.update).toHaveBeenCalledWith(1, { sku: null });
  });

  it("refuses a SKU another product already has, naming it", async () => {
    vi.mocked(productRepository.findBySku).mockResolvedValue({ id: 2, name: "SWEET B" });
    await expect(updateProduct(1, { sku: "AFP-008" }, 7)).rejects.toMatchObject({ status: 409, message: "SKU AFP-008 is already used by SWEET B." });
    expect(productRepository.update).not.toHaveBeenCalled();
  });

  it("does not look for a duplicate when the SKU is unchanged", async () => {
    await updateProduct(1, { sku: "AFP007" }, 7);
    expect(productRepository.findBySku).not.toHaveBeenCalled();
  });
});

describe("updateProduct - category", () => {
  it("joins an existing category by its own spelling", async () => {
    const existing = { id: 1, sku: null, name: "SWEET A", category: "Class B", unit: "Liter", sortOrder: 1 };
    vi.mocked(productRepository.findById).mockResolvedValue(existing as never);
    vi.mocked(productRepository.findAll).mockResolvedValue([{ category: "Class A (Gallon)" }] as never);
    vi.mocked(productRepository.update).mockResolvedValue(existing as never);
    await updateProduct(1, { category: "class a  (gallon)", unit: " Gallon " }, 7);
    expect(productRepository.update).toHaveBeenCalledWith(1, { category: "Class A (Gallon)", unit: "Gallon" });
  });
});

describe("deleteProductPermanently", () => {
  const existing = { id: 5, name: "TYPO PRODUCT" };

  it("deletes a product that was never used, and records it", async () => {
    vi.mocked(productRepository.findById).mockResolvedValue(existing as never);
    vi.mocked(productRepository.countReferences).mockResolvedValue(0);
    await deleteProductPermanently(5, 7);
    expect(productRepository.delete).toHaveBeenCalledWith(5);
    expect(recordChange).toHaveBeenCalledWith(expect.objectContaining({ action: "DELETE", recordId: 5, oldValue: existing }));
  });

  it("refuses one with history and points to deactivating", async () => {
    vi.mocked(productRepository.findById).mockResolvedValue(existing as never);
    vi.mocked(productRepository.countReferences).mockResolvedValue(12);
    await expect(deleteProductPermanently(5, 7)).rejects.toMatchObject({ status: 409, message: expect.stringContaining("Deactivate it instead") });
    expect(productRepository.delete).not.toHaveBeenCalled();
  });

  it("404s on an unknown product", async () => {
    vi.mocked(productRepository.findById).mockResolvedValue(null);
    await expect(deleteProductPermanently(9, 7)).rejects.toMatchObject({ status: 404 });
  });
});

describe("deactivateProduct", () => {
  it("updates isActive to false via updateProduct", async () => {
    const existing = { id: 1, name: "Sweet A", category: "Class A", unit: "Liter", sortOrder: 1 };
    vi.mocked(productRepository.findById).mockResolvedValue(existing as never);
    vi.mocked(productRepository.update).mockResolvedValue({ ...existing, isActive: false } as never);

    await deactivateProduct(1, 7);

    expect(productRepository.update).toHaveBeenCalledWith(1, { isActive: false });
  });
});
