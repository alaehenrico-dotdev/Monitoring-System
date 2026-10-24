import { beforeEach, describe, expect, it, vi } from "vitest";

const http = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn(), patch: vi.fn(), put: vi.fn(), delete: vi.fn() }));
vi.mock("./http", () => ({ http }));

import {
  PRODUCTS_CHANGED_EVENT,
  createProduct,
  deactivateProduct,
  deleteProductPermanently,
  reorderProducts,
  syncProducts,
  updateProduct,
} from "./products";

const changed = vi.fn();
beforeEach(() => {
  vi.clearAllMocks();
  window.removeEventListener(PRODUCTS_CHANGED_EVENT, changed);
  window.addEventListener(PRODUCTS_CHANGED_EVENT, changed);
});

describe("product changes announce themselves, so the quick-jump palette refetches", () => {
  it.each([
    ["createProduct", () => createProduct({ name: "A", category: "C", unit: "pc" }), "post"],
    ["updateProduct", () => updateProduct(1, { name: "B" }), "patch"],
    ["deactivateProduct", () => deactivateProduct(1), "delete"],
    ["deleteProductPermanently", () => deleteProductPermanently(1), "delete"],
    ["reorderProducts", () => reorderProducts([2, 1]), "put"],
    ["syncProducts", () => syncProducts([{ category: "C", name: "A" }]), "post"],
  ] as const)("%s fires the event once it has succeeded, and returns the server's answer", async (_name, call, verb) => {
    http[verb].mockResolvedValue({ ok: true });
    await expect(call()).resolves.toEqual({ ok: true });
    expect(changed).toHaveBeenCalledTimes(1);
  });

  it("stays quiet when the request fails (nothing changed, nothing to refresh)", async () => {
    http.post.mockRejectedValue(new Error("boom"));
    await expect(createProduct({ name: "A", category: "C", unit: "pc" })).rejects.toThrow("boom");
    expect(changed).not.toHaveBeenCalled();
  });
});
