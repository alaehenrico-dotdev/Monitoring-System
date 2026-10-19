import { productRepository } from "../repositories/productRepository";
import { HttpError } from "../utils/HttpError";
import { serializableTransaction } from "../lib/prisma";
import { strictKey } from "../utils/strictKey";
import { normalizeProductName } from "../utils/productName";
import { broadcastRealtimeEvent } from "../lib/realtime";
import { logSystemEvent, recordChange } from "./changeLog.service";

export async function listProducts(includeInactive = false) {
  return productRepository.findAll(includeInactive);
}

/**
 * Adds a product. Without an explicit `sortOrder` it is placed right after the
 * last product of its category (or at the very end for a new category), so it
 * shows up with the products it belongs with rather than at the bottom of the
 * whole list, and every product after it moves down one place.
 *
 * The category is matched to an existing one the way a person reads it (letter
 * case and spacing ignored) and takes that category's own spelling, so typing
 * "class a (gallon)" joins "Class A (Gallon)" instead of starting a second
 * category group that looks the same. Done in one SERIALIZABLE transaction so
 * two people adding at once cannot take the same place.
 */
export async function createProduct(
  data: { sku?: string; name: string; category: string; unit: string; sortOrder?: number; lowStockThreshold?: number | null },
  changedById?: number
) {
  if (data.sortOrder !== undefined) {
    const product = await productRepository.create({
      sku: data.sku,
      name: normalizeProductName(data.name),
      category: data.category,
      unit: data.unit,
      sortOrder: data.sortOrder,
      lowStockThreshold: data.lowStockThreshold ?? null,
    });
    await recordChange({ tableName: "products", recordId: product.id, action: "CREATE", changedById, newValue: product });
    productRepository.invalidateCache();
    return product;
  }

  const product = await serializableTransaction(async (tx) => {
    const all = await tx.product.findMany({ orderBy: [{ sortOrder: "asc" }, { name: "asc" }, { id: "asc" }] });
    const wanted = strictKey(data.category);
    const category = all.find((p) => strictKey(p.category) === wanted)?.category ?? data.category.trim().replace(/\s+/g, " ");

    const created = await tx.product.create({
      data: { sku: data.sku, name: normalizeProductName(data.name), category, unit: data.unit, sortOrder: all.length + 1, lowStockThreshold: data.lowStockThreshold ?? null },
    });

    // The new product goes after the last one of its category, else at the end.
    let at = all.length;
    for (let i = all.length - 1; i >= 0; i--) {
      if (strictKey(all[i].category) === wanted) {
        at = i + 1;
        break;
      }
    }
    const order = [...all.slice(0, at).map((p) => p.id), created.id, ...all.slice(at).map((p) => p.id)];
    const current = new Map<number, number>([...all.map((p) => [p.id, p.sortOrder] as const), [created.id, all.length + 1]]);
    let placed = created;
    for (const [i, id] of order.entries()) {
      if (current.get(id) === i + 1) continue;
      const updated = await tx.product.update({ where: { id }, data: { sortOrder: i + 1 } });
      if (id === created.id) placed = updated;
    }
    await recordChange({ tableName: "products", recordId: placed.id, action: "CREATE", changedById, newValue: placed }, tx);
    return placed;
  });

  productRepository.invalidateCache();
  broadcastRealtimeEvent();
  return product;
}

export async function updateProduct(
  id: number,
  data: Partial<{ sku: string | null; name: string; category: string; unit: string; sortOrder: number; isActive: boolean; lowStockThreshold: number | null }>,
  changedById?: number
) {
  const existing = await productRepository.findById(id);
  if (!existing) throw HttpError.notFound("Product not found");

  const patch = { ...data };
  if (patch.name !== undefined) patch.name = normalizeProductName(patch.name);
  if (patch.unit !== undefined) patch.unit = patch.unit.trim();
  if (patch.category !== undefined) {
    // Joins an existing category the way createProduct does (case and spacing
    // ignored), so an edit cannot start a second group that looks the same.
    const wanted = strictKey(patch.category);
    const all = await productRepository.findAll(true);
    patch.category = all.find((p) => strictKey(p.category) === wanted)?.category ?? patch.category.trim().replace(/\s+/g, " ");
  }
  if (patch.sku !== undefined) {
    // A SKU code is edited freely (hyphens, spacing, a new numbering...): trimmed,
    // and blank clears it. It must stay unique, so say who has it rather than
    // letting the database's generic conflict message through.
    const sku = patch.sku === null ? "" : patch.sku.trim();
    patch.sku = sku === "" ? null : sku;
    if (patch.sku !== null && patch.sku !== existing.sku) {
      const holder = await productRepository.findBySku(patch.sku);
      if (holder && holder.id !== id) throw HttpError.conflict(`SKU ${patch.sku} is already used by ${holder.name}.`);
    }
  }

  const updated = await productRepository.update(id, patch);
  await recordChange({ tableName: "products", recordId: id, action: "UPDATE", changedById, oldValue: existing, newValue: updated });
  return updated;
}

/// Deletes a product for good - only one that was never used (a typo, a duplicate
/// added by mistake). Anything with entries, counts, extras or awaiting-release
/// items keeps its history and has to be deactivated instead.
export async function deleteProductPermanently(id: number, changedById?: number) {
  const existing = await productRepository.findById(id);
  if (!existing) throw HttpError.notFound("Product not found");
  const used = await productRepository.countReferences(id);
  if (used > 0) {
    throw HttpError.conflict(`${existing.name} has stock history (${used} record${used === 1 ? "" : "s"}), so it cannot be deleted. Deactivate it instead - its history stays.`);
  }
  await productRepository.delete(id);
  await recordChange({ tableName: "products", recordId: id, action: "DELETE", changedById, oldValue: existing });
  broadcastRealtimeEvent();
  return { id };
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
