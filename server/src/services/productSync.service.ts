import type { Product } from "@prisma/client";
import { serializableTransaction } from "../lib/prisma";
import { broadcastRealtimeEvent } from "../lib/realtime";
import { HttpError } from "../utils/HttpError";
import { strictKey } from "../utils/strictKey";
import { productRepository } from "../repositories/productRepository";
import { logSystemEvent, recordChange } from "./changeLog.service";

export interface ProductSyncItem {
  category: string;
  name: string;
  /// Set by the client when it already resolved this row to an existing
  /// product (including one that must move to this row's category).
  productId?: number;
  /// With productId: the sheet's spelling replaces the product's name (the
  /// admin said it is the same product), keeping its SKU, history and id.
  rename?: boolean;
}

const pairKey = (category: string, name: string) => `${strictKey(category)}\u0000${strictKey(name)}`;
const tidy = (s: string) => s.trim().replace(/\s+/g, " ");

interface Outcome {
  created: Product[];
  changed: { before: Product; after: Product }[];
  renamed: number;
  reactivated: number;
  reordered: number;
  total: number;
}

/**
 * Makes the product master list follow a spreadsheet: products the sheet has
 * and the system lacks are created (no SKU - it shows as a dash - and the unit
 * of their category, or "-" for a brand-new category), a product the client
 * resolved to another category is moved (or, if the admin linked it, renamed
 * to the sheet's spelling), and every product's sortOrder becomes its position
 * in the sheet, so categories and products come out in the sheet's sequence.
 * Products the sheet does not mention keep their relative order after the
 * sheet's.
 *
 * One SERIALIZABLE transaction with the list read inside it: a failure part way
 * leaves the list exactly as it was, and two admins syncing at once cannot both
 * create the same new product. A product that matches the sheet but was retired
 * is switched back on - the sheet lists it, and left inactive it would match
 * here yet never appear in the grids. Idempotent: running it again with the
 * same items changes nothing, and a row that strictly matches an existing
 * product (or one created earlier in the same run) is reused, never duplicated.
 */
export async function syncProductsFromSheet(items: ProductSyncItem[], userId?: number) {
  const outcome = await serializableTransaction<Outcome>(async (tx) => {
    const all = await tx.product.findMany({ orderBy: [{ sortOrder: "asc" }, { name: "asc" }] });
    const byId = new Map(all.map((p) => [p.id, p]));
    const lookup = new Map<string, Product>();
    for (const p of all) if (!lookup.has(pairKey(p.category, p.name))) lookup.set(pairKey(p.category, p.name), p);

    const created: Product[] = [];
    const changed: { before: Product; after: Product }[] = [];
    const order: number[] = [];
    const seen = new Set<number>();
    let renamed = 0;
    let reactivated = 0;
    let reordered = 0;

    for (const item of items) {
      const category = tidy(item.category);
      const name = tidy(item.name);
      let product = item.productId !== undefined ? byId.get(item.productId) : lookup.get(pairKey(category, name));
      if (item.productId !== undefined && !product) throw HttpError.badRequest(`Unknown product id ${item.productId}`);

      if (!product) {
        const unit = all.find((p) => strictKey(p.category) === strictKey(category))?.unit ?? "-";
        product = await tx.product.create({ data: { name, category, unit, sortOrder: 0 } });
        created.push(product);
        lookup.set(pairKey(category, name), product);
      } else {
        const data: { category?: string; name?: string; isActive?: boolean } = {};
        if (strictKey(product.category) !== strictKey(category)) data.category = category;
        if (item.rename && item.productId !== undefined && product.name !== name) {
          data.name = name;
          renamed++;
        }
        if (!product.isActive) {
          data.isActive = true;
          reactivated++;
        }
        if (Object.keys(data).length > 0) {
          const after = await tx.product.update({ where: { id: product.id }, data });
          changed.push({ before: product, after });
          byId.set(after.id, after);
          product = after;
        }
      }
      if (seen.has(product.id)) continue;
      seen.add(product.id);
      order.push(product.id);
    }
    for (const p of all) if (!seen.has(p.id)) order.push(p.id);

    const current = new Map<number, number>([...all.map((p) => [p.id, p.sortOrder] as const), ...created.map((p) => [p.id, 0] as const)]);
    const isNew = new Set(created.map((p) => p.id));
    for (const [i, id] of order.entries()) {
      if (current.get(id) === i + 1) continue;
      await tx.product.update({ where: { id }, data: { sortOrder: i + 1 } });
      if (!isNew.has(id)) reordered++;
    }

    for (const p of created) await recordChange({ tableName: "products", recordId: p.id, action: "CREATE", changedById: userId, newValue: p }, tx);
    for (const c of changed) {
      await recordChange(
        { tableName: "products", recordId: c.after.id, action: "UPDATE", changedById: userId, oldValue: c.before, newValue: c.after },
        tx,
      );
    }
    return { created, changed, renamed, reactivated, reordered, total: order.length };
  });

  productRepository.invalidateCache();
  if (outcome.created.length || outcome.changed.length || outcome.reordered) {
    await logSystemEvent(
      "product_sync",
      {
        created: outcome.created.length,
        changed: outcome.changed.length,
        renamed: outcome.renamed,
        reactivated: outcome.reactivated,
        reordered: outcome.reordered,
      },
      userId ?? null,
      "UPDATE",
    );
    broadcastRealtimeEvent();
  }
  return {
    created: outcome.created.length,
    moved: outcome.changed.length,
    renamed: outcome.renamed,
    reactivated: outcome.reactivated,
    reordered: outcome.reordered,
    total: outcome.total,
  };
}
