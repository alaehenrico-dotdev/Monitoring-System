import { productRepository } from "../repositories/productRepository";
import { HttpError } from "../utils/HttpError";
import { serializableTransaction } from "../lib/prisma";
import { broadcastRealtimeEvent } from "../lib/realtime";
import { logSystemEvent, recordChange } from "./changeLog.service";

export async function listProducts(includeInactive = false) {
  return productRepository.findAll(includeInactive);
}

export async function createProduct(
  data: { sku?: string; name: string; category: string; unit: string; sortOrder?: number; lowStockThreshold?: number | null },
  changedById?: number
) {
  const sortOrder = data.sortOrder ?? (await productRepository.nextSortOrder());
  const product = await productRepository.create({
    sku: data.sku,
    name: data.name,
    category: data.category,
    unit: data.unit,
    sortOrder,
    lowStockThreshold: data.lowStockThreshold ?? null,
  });

  await recordChange({ tableName: "products", recordId: product.id, action: "CREATE", changedById, newValue: product });
  return product;
}

export async function updateProduct(
  id: number,
  data: Partial<{ sku: string | null; name: string; category: string; unit: string; sortOrder: number; isActive: boolean; lowStockThreshold: number | null }>,
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

/// Applies an admin-chosen order to the product master list. `orderedIds` is the
/// new sequence (each product carries its SKU with it - the SKU is a column of
/// the same row); products it does not mention keep their relative order after
/// them. Every grid, report and picker reads sortOrder, so this one write
/// reorders the whole system. One SERIALIZABLE transaction: a failure part way
/// leaves the order as it was, and two admins reordering at once cannot
/// interleave.
export async function reorderProducts(orderedIds: number[], userId?: number) {
  if (new Set(orderedIds).size !== orderedIds.length) throw HttpError.badRequest("Duplicate product ids in the new order");

  const moved = await serializableTransaction(async (tx) => {
    const all = await tx.product.findMany({ orderBy: [{ sortOrder: "asc" }, { name: "asc" }, { id: "asc" }] });
    const known = new Set(all.map((p) => p.id));
    const unknown = orderedIds.find((id) => !known.has(id));
    if (unknown !== undefined) throw HttpError.badRequest(`Unknown product id ${unknown}`);

    const listed = new Set(orderedIds);
    const order = [...orderedIds, ...all.filter((p) => !listed.has(p.id)).map((p) => p.id)];
    const current = new Map(all.map((p) => [p.id, p.sortOrder] as const));

    let count = 0;
    for (const [i, id] of order.entries()) {
      if (current.get(id) === i + 1) continue;
      await tx.product.update({ where: { id }, data: { sortOrder: i + 1 } });
      count++;
    }
    return count;
  });

  productRepository.invalidateCache();
  if (moved > 0) {
    await logSystemEvent("product_reorder", { moved }, userId ?? null, "UPDATE");
    broadcastRealtimeEvent();
  }
  return { moved, total: orderedIds.length };
}
