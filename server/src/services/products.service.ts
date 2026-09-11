import { productRepository } from "../repositories/productRepository";
import { HttpError } from "../utils/HttpError";
import { recordChange } from "./changeLog.service";

export async function listProducts(includeInactive = false) {
  return productRepository.findAll(includeInactive);
}

export async function createProduct(
  data: { name: string; category: string; unit: string; sortOrder?: number },
  changedById?: number
) {
  const sortOrder = data.sortOrder ?? (await productRepository.nextSortOrder(data.category));
  const product = await productRepository.create({ name: data.name, category: data.category, unit: data.unit, sortOrder });

  await recordChange({ tableName: "products", recordId: product.id, action: "CREATE", changedById, newValue: product });
  return product;
}

export async function updateProduct(
  id: number,
  data: Partial<{ name: string; category: string; unit: string; sortOrder: number; isActive: boolean }>,
  changedById?: number
) {
  const existing = await productRepository.findById(id);
  if (!existing) throw HttpError.notFound("Product not found");

  const updated = await productRepository.update(id, data);
  await recordChange({ tableName: "products", recordId: id, action: "UPDATE", changedById, oldValue: existing, newValue: updated });
  return updated;
}

/// Products are never hard-deleted (Section 4.1: "Allows retiring a SKU
/// without deleting its history") - deactivate instead.
export async function deactivateProduct(id: number, changedById?: number) {
  return updateProduct(id, { isActive: false }, changedById);
}
