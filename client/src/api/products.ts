import { http } from "./http";
import type { Product } from "../types";

/// By default only active products come back (what every grid and the
/// receipt form want). The admin list passes `includeInactive` so
/// deactivated SKUs stay visible there - otherwise there'd be nothing to
/// click "Reactivate" on.
export function listProducts(options: { includeInactive?: boolean } = {}) {
  return http.get<Product[]>(options.includeInactive ? "/products?includeInactive=true" : "/products");
}

export function createProduct(data: { sku?: string; name: string; category: string; unit: string }) {
  return http.post<Product>("/products", data);
}

export function updateProduct(id: number, data: Partial<Pick<Product, "sku" | "name" | "category" | "unit" | "isActive">>) {
  return http.patch<Product>(`/products/${id}`, data);
}

export function deactivateProduct(id: number) {
  return http.delete<Product>(`/products/${id}`);
}