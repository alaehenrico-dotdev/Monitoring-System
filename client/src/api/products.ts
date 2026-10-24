import { http } from "./http";
import type { Product } from "../types";

/// Fired on `window` after anything changes the product list. The Ctrl+K palette caches
/// the list for the whole session (components/QuickJump.tsx) and listens for this to
/// refetch, so a product added, renamed, reordered or switched off shows up straight away.
export const PRODUCTS_CHANGED_EVENT = "ae:products-changed";

export function notifyProductsChanged(): void {
  if (typeof window !== "undefined") window.dispatchEvent(new Event(PRODUCTS_CHANGED_EVENT));
}

/// Runs a mutation, then announces the change - but only when it succeeded.
async function thenNotify<T>(request: Promise<T>): Promise<T> {
  const result = await request;
  notifyProductsChanged();
  return result;
}

/// By default only active products come back (what every grid and the
/// receipt form want). The admin list passes `includeInactive` so
/// deactivated SKUs stay visible there - otherwise there'd be nothing to
/// click "Reactivate" on.
export function listProducts(options: { includeInactive?: boolean } = {}) {
  return http.get<Product[]>(options.includeInactive ? "/products?includeInactive=true" : "/products");
}

export function createProduct(data: { sku?: string; name: string; category: string; unit: string; lowStockThreshold?: number | null }) {
  return thenNotify(http.post<Product>("/products", data));
}

export function updateProduct(id: number, data: Partial<Pick<Product, "sku" | "name" | "category" | "unit" | "isActive" | "lowStockThreshold">>) {
  return thenNotify(http.patch<Product>(`/products/${id}`, data));
}

/// Deletes a never-used product for good; the server refuses one with history.
export function deleteProductPermanently(id: number) {
  return thenNotify(http.delete<{ id: number }>(`/products/${id}/permanent`));
}

export function deactivateProduct(id: number) {
  return thenNotify(http.delete<Product>(`/products/${id}`));
}
/// Supervisor/Admin: set the product sequence (each product's SKU moves with
/// it). One shared order - every grid, report and picker follows it.
export function reorderProducts(orderedIds: number[]) {
  return thenNotify(http.put<{ moved: number; total: number }>("/products/order", { orderedIds }));
}

export interface ProductSyncResult {
  created: number;
  moved: number;
  renamed: number;
  reactivated: number;
  reordered: number;
  total: number;
  /// Products merged into another one by this sync.
  merged?: number;
  /// Products switched off because the sheet did not list them.
  deactivated?: number;
}

/// Supervisor/Admin: add the sheet's missing products (no SKU) and apply its
/// category/product sequence. One request, one transaction, safe to retry.
/// `mergeFromId` (with `productId`): a product without a SKU that is the same product -
/// its entries move onto `productId` and it is deleted (see the server's productMerge.service.ts).
/// `deactivateUnlisted`: also switch off (never delete) every active product the sheet does
/// not list, so the lists show exactly the sheet's products.
export function syncProducts(
  items: { category: string; name: string; productId?: number; rename?: boolean; mergeFromId?: number }[],
  options: { deactivateUnlisted?: boolean } = {},
) {
  return thenNotify(http.post<ProductSyncResult>("/products/sync", { items, deactivateUnlisted: options.deactivateUnlisted === true }));
}
