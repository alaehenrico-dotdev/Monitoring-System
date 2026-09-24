import { beforeEach, describe, expect, it, vi } from "vitest";
import { HttpError } from "../utils/HttpError";

vi.mock("../repositories/productRepository", () => ({
  productRepository: {
    findAll: vi.fn(),
    nextSortOrder: vi.fn(),
    create: vi.fn(),
    findById: vi.fn(),
    update: vi.fn(),
  },
}));
vi.mock("./changeLog.service", () => ({
  recordChange: vi.fn(),
}));

import { productRepository } from "../repositories/productRepository";
import { recordChange } from "./changeLog.service";
import { createProduct, deactivateProduct, listProducts, updateProduct } from "./products.service";

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
  it("assigns the next sort order for the category when none is given, and records the change", async () => {
    vi.mocked(productRepository.nextSortOrder).mockResolvedValue(3);
    const created = { id: 1, name: "Sweet A", category: "Class A", unit: "Liter", sortOrder: 3 };
    vi.mocked(productRepository.create).mockResolvedValue(created as never);

    const result = await createProduct({ name: "Sweet A", category: "Class A", unit: "Liter" }, 7);

    expect(productRepository.nextSortOrder).toHaveBeenCalledWith("Class A");
    expect(productRepository.create).toHaveBeenCalledWith(expect.objectContaining({ name: "Sweet A", sortOrder: 3 }));
    expect(recordChange).toHaveBeenCalledWith(
      expect.objectContaining({ tableName: "products", action: "CREATE", changedById: 7, newValue: created }),
    );
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

    expect(productRepository.update).toHaveBeenCalledWith(1, { name: "New name" });
    expect(recordChange).toHaveBeenCalledWith(
      expect.objectContaining({ action: "UPDATE", oldValue: existing, newValue: updated }),
    );
    expect(result).toBe(updated);
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
