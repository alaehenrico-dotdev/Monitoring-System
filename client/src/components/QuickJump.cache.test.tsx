import { beforeEach, describe, expect, it, vi } from "vitest";

const listProducts = vi.hoisted(() => vi.fn());
vi.mock("../api/products", async () => ({
  ...(await vi.importActual<typeof import("../api/products")>("../api/products")),
  listProducts,
}));

import { notifyProductsChanged } from "../api/products";
import { clearQuickJumpProductCache, loadProducts } from "./QuickJump";

const product = (id: number) => ({ id, sku: `S${id}`, name: `P${id}`, category: "C", unit: "pc", isActive: true, sortOrder: id, lowStockThreshold: null });

beforeEach(() => {
  vi.clearAllMocks();
  clearQuickJumpProductCache();
});

describe("the Ctrl+K palette's product list", () => {
  it("is fetched once and reused while nothing changes", async () => {
    listProducts.mockResolvedValue([product(1)]);
    await loadProducts();
    await loadProducts();
    expect(listProducts).toHaveBeenCalledTimes(1);
  });

  it("is fetched again after the product list changes (a SKU added, renamed, switched off, or a data reset)", async () => {
    listProducts.mockResolvedValueOnce([product(1)]).mockResolvedValueOnce([product(1), product(2)]);
    expect(await loadProducts()).toHaveLength(1);

    notifyProductsChanged();

    expect(await loadProducts()).toHaveLength(2);
    expect(listProducts).toHaveBeenCalledTimes(2);
  });

  it("retries on the next open after a failed load instead of staying empty", async () => {
    listProducts.mockRejectedValueOnce(new Error("offline")).mockResolvedValueOnce([product(1)]);
    expect(await loadProducts()).toEqual([]);
    expect(await loadProducts()).toHaveLength(1);
  });
});
