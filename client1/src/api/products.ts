import { http } from "./http";
import type { Product } from "../types";

export function listProducts() {
  return http.get<Product[]>("/products");
}

export function createProduct(data: { name: string; category: string; unit: string }) {
  return http.post<Product>("/products", data);
}

export function updateProduct(id: number, data: Partial<Pick<Product, "name" | "category" | "unit" | "isActive">>) {
  return http.patch<Product>(`/products/${id}`, data);
}

export function deactivateProduct(id: number) {
  return http.delete<Product>(`/products/${id}`);
}
