import { prisma, type Db } from "../lib/prisma";
import { getOrSet, invalidatePrefix } from "../lib/cache";

export interface ProductCreateData {
  sku?: string;
  name: string;
  category: string;
  unit: string;
  sortOrder: number;
}

export interface ProductUpdateData {
  sku?: string | null;
  name?: string;
  category?: string;
  unit?: string;
  sortOrder?: number;
  isActive?: boolean;
}

const CACHE_PREFIX = "products:";
const CACHE_KEY_ACTIVE = `${CACHE_PREFIX}active`;
const CACHE_KEY_ALL = `${CACHE_PREFIX}all`;
// The product master list (Section 4.1) is read on nearly every grid,
// report, and the receipt item picker, but only ever changes through a
// deliberate admin action (add/rename/deactivate a SKU) - a short TTL plus
// write-time invalidation keeps it from being re-queried on every request
// without any risk of an admin's edit going unnoticed for long.
const TTL_MS = 60_000;

const ORDER_BY = [{ category: "asc" }, { sortOrder: "asc" }, { name: "asc" }] as const;

/// Section 5.1 - products: the master list every other table reads from.
export const productRepository = {
  findActive() {
    return getOrSet(CACHE_KEY_ACTIVE, TTL_MS, () =>
      prisma.product.findMany({ where: { isActive: true }, orderBy: [...ORDER_BY] })
    );
  },

  findAll(includeInactive: boolean) {
    const cacheKey = includeInactive ? CACHE_KEY_ALL : CACHE_KEY_ACTIVE;
    return getOrSet(cacheKey, TTL_MS, () =>
      prisma.product.findMany({ where: includeInactive ? undefined : { isActive: true }, orderBy: [...ORDER_BY] })
    );
  },

  findById(id: number) {
    return prisma.product.findUnique({ where: { id } });
  },

  findActiveById(id: number, db: Db = prisma) {
    return db.product.findFirst({ where: { id, isActive: true } });
  },

  findByNameAndCategory(name: string, category: string) {
    return prisma.product.findFirst({ where: { name, category } });
  },

  async nextSortOrder(category: string): Promise<number> {
    const result = await prisma.product.aggregate({ where: { category }, _max: { sortOrder: true } });
    return (result._max.sortOrder ?? 0) + 1;
  },

  create(data: ProductCreateData) {
    invalidatePrefix(CACHE_PREFIX);
    return prisma.product.create({ data });
  },

  update(id: number, data: ProductUpdateData) {
    invalidatePrefix(CACHE_PREFIX);
    return prisma.product.update({ where: { id }, data });
  },
};
