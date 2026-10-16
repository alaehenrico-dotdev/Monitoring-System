import { http } from "./http";
import type { Product } from "../types";

/// By default only active products come back (what every grid and the
/// receipt form want). The admin list passes `includeInactive` so
/// deactivated SKUs stay visible there - otherwise there'd be nothing to
/// click "Reactivate" on.
export function listProducts(options: { includeInactive?: boolean } = {}) {
  return http.get<Product[]>(options.includeInactive ? "/products?includeInactive=true" : "/products");
}

export function createProduct(data: { sku?: string; name: string; category: string; unit: string; lowStockThreshold?: number | null }) {
  return http.post<Product>("/products", data);
}

export function updateProduct(id: number, data: Partial<Pick<Product, "sku" | "name" | "category" | "unit" | "isActive" | "lowStockThreshold">>) {
  return http.patch<Product>(`/products/${id}`, data);
}

export function deactivateProduct(id: number) {
  return http.delete<Product>(`/products/${id}`);
}
/// Supervisor/Admin: set the product sequence (each product's SKU moves with
/// it). One shared order - every grid, report and picker follows it.
export function reorderProducts(orderedIds: number[]) {
  return http.put<{ moved: number; total: number }>("/products/order", { orderedIds });
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
  return http.post<ProductSyncResult>("/products/sync", { items, deactivateUnlisted: options.deactivateUnlisted === true });
}
