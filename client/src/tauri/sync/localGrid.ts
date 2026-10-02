// Offline-cold-start fallback for the three entry grids (Online/Offline
// Entry, Manual Count) - reconstructed from the structured local SQLite
// mirror (localDb.ts) instead of the server, for a date/shift this device
// has never specifically loaded online before. The generic exact-URL cache
// (tauri/offlineStore.ts) only helps once that exact grid has already been
// fetched successfully at least once; this works for ANY date, because a
// full pull (sync/engine.ts's runPull) mirrors every row the server has, not
// just ones this device happened to view. The same carry-forward helper the
// offline staging functions already use (getLocalOpeningStockOnline/Offline)
// is reused here, so even a never-before-seen date still gets a sensible
// opening stock.
//
// Entirely a best-effort preview, same caveat as the staging functions this
// reuses: the server remains the only authoritative source, recomputing
// everything for real the next time this client syncs. Never trusted for a
// SAVE - only onImportRow/stage*'s own staging functions write anything;
// these are read-only.
import {
  getLocalOpeningStockOffline,
  getLocalOpeningStockOnline,
  getManualCountPending,
  getOfflineStockPending,
  getOnlineStockPending,
  listManualCountsCacheForDate,
  listOfflineStockCacheForDate,
  listOnlineStockCacheForDate,
  listProductsCache,
} from "./localDb";
import type { OfflineStockCache, OnlineStockCache, ProductCache, Shift, StockLocation } from "./types";
import type { OfflineEntry, OfflineGridRow, ManualCountGridRow, OnlineEntry, OnlineGridRow, Product } from "../../types";

function toProduct(p: ProductCache): Product {
  return {
    id: p.id,
    sku: p.sku,
    name: p.name,
    category: p.category,
    unit: p.unit,
    isActive: p.isActive,
    sortOrder: p.sortOrder,
    lowStockThreshold: p.lowStockThreshold,
  };
}

async function onlineEntryFromCache(cache: OnlineStockCache): Promise<OnlineEntry> {
  const pending = await getOnlineStockPending(cache.localId);
  const productionIn = cache.productionIn + (pending?.productionIn ?? 0);
  const fulfillmentOut = cache.fulfillmentOut + (pending?.fulfillmentOut ?? 0);
  const rts = cache.rts + (pending?.rts ?? 0);
  // Same formulas as localDb.ts's stageOnlineEdit - openingStock/transfer
  // fields never move locally (only a real save/sync can change those).
  const onlineStock = cache.openingStock + cache.stockInOffToOl - cache.stockOutOlToOff;
  const remainingStock = onlineStock + productionIn - fulfillmentOut + rts;
  return {
    productId: cache.productId,
    entryDate: cache.entryDate,
    shift: cache.shift,
    openingStock: cache.openingStock,
    stockInOffToOl: cache.stockInOffToOl,
    stockOutOlToOff: cache.stockOutOlToOff,
    onlineStock,
    productionIn,
    fulfillmentOut,
    rts,
    remainingStock,
  };
}

export async function getLocalOnlineGrid(entryDate: string, shift: Shift): Promise<OnlineGridRow[]> {
  const [products, cacheRows] = await Promise.all([listProductsCache(), listOnlineStockCacheForDate(entryDate, shift)]);
  const byProduct = new Map(cacheRows.map((r) => [r.productId, r]));

  return Promise.all(
    products
      .filter((p) => p.isActive)
      .map(async (p): Promise<OnlineGridRow> => {
        const cache = byProduct.get(p.id);
        if (cache) return { product: toProduct(p), entry: await onlineEntryFromCache(cache), isSaved: cache.serverId !== null };

        const openingStock = await getLocalOpeningStockOnline(p.id, entryDate, shift);
        const entry: OnlineEntry = {
          productId: p.id,
          entryDate,
          shift,
          openingStock,
          stockInOffToOl: 0,
          stockOutOlToOff: 0,
          onlineStock: openingStock,
          productionIn: 0,
          fulfillmentOut: 0,
          rts: 0,
          remainingStock: openingStock,
        };
        return { product: toProduct(p), entry, isSaved: false };
      }),
  );
}

const OFFLINE_ADDITIVE_FIELDS = ["productionIn", "delivery1", "delivery2", "delivery3", "delivery4", "delivery5", "backloads", "upsellOut"] as const;

async function offlineEntryFromCache(cache: OfflineStockCache): Promise<OfflineEntry> {
  const pending = await getOfflineStockPending(cache.localId);
  const merged = Object.fromEntries(
    OFFLINE_ADDITIVE_FIELDS.map((f) => [f, cache[f] + (pending?.[f] ?? 0)]),
  ) as Record<(typeof OFFLINE_ADDITIVE_FIELDS)[number], number>;
  const deliveryOut = merged.delivery1 + merged.delivery2 + merged.delivery3 + merged.delivery4 + merged.delivery5;
  // Same formulas as localDb.ts's stageOfflineEdit.
  const offlineStock = cache.openingStock + cache.stockInOlToOff - cache.stockOutOffToOl;
  const remainingStock = offlineStock + merged.productionIn - deliveryOut - merged.upsellOut + merged.backloads;
  return {
    productId: cache.productId,
    entryDate: cache.entryDate,
    shift: cache.shift,
    openingStock: cache.openingStock,
    stockInOlToOff: cache.stockInOlToOff,
    stockOutOffToOl: cache.stockOutOffToOl,
    offlineStock,
    productionIn: merged.productionIn,
    deliveryOut,
    delivery1: merged.delivery1,
    delivery2: merged.delivery2,
    delivery3: merged.delivery3,
    delivery4: merged.delivery4,
    delivery5: merged.delivery5,
    upsellOut: merged.upsellOut,
    backloads: merged.backloads,
    remainingStock,
  };
}

export async function getLocalOfflineGrid(entryDate: string, shift: Shift): Promise<OfflineGridRow[]> {
  const [products, cacheRows] = await Promise.all([listProductsCache(), listOfflineStockCacheForDate(entryDate, shift)]);
  const byProduct = new Map(cacheRows.map((r) => [r.productId, r]));

  return Promise.all(
    products
      .filter((p) => p.isActive)
      .map(async (p): Promise<OfflineGridRow> => {
        const cache = byProduct.get(p.id);
        if (cache) return { product: toProduct(p), entry: await offlineEntryFromCache(cache), isSaved: cache.serverId !== null };

        const openingStock = await getLocalOpeningStockOffline(p.id, entryDate, shift);
        const entry: OfflineEntry = {
          productId: p.id,
          entryDate,
          shift,
          openingStock,
          stockInOlToOff: 0,
          stockOutOffToOl: 0,
          offlineStock: openingStock,
          productionIn: 0,
          deliveryOut: 0,
          delivery1: 0,
          delivery2: 0,
          delivery3: 0,
          delivery4: 0,
          delivery5: 0,
          upsellOut: 0,
          backloads: 0,
          remainingStock: openingStock,
        };
        return { product: toProduct(p), entry, isSaved: false };
      }),
  );
}

/// Mirrors the server's own getManualCountGrid (manualCounts.service.ts):
/// TOTAL combines the Online + Offline grids' remaining stock; ONLINE/OFFLINE
/// read from just the matching one. Pulls the other two local grids for
/// this, so it shares their same best-effort carry-forward.
export async function getLocalManualCountGrid(entryDate: string, shift: Shift, location: StockLocation): Promise<ManualCountGridRow[]> {
  const needsOnline = location === "ONLINE" || location === "TOTAL";
  const needsOffline = location === "OFFLINE" || location === "TOTAL";
  const [products, onlineGrid, offlineGrid, counts] = await Promise.all([
    listProductsCache(),
    needsOnline ? getLocalOnlineGrid(entryDate, shift) : Promise.resolve([]),
    needsOffline ? getLocalOfflineGrid(entryDate, shift) : Promise.resolve([]),
    listManualCountsCacheForDate(entryDate, shift, location),
  ]);
  const onlineByProduct = new Map(onlineGrid.map((r) => [r.product.id, r.entry.remainingStock]));
  const offlineByProduct = new Map(offlineGrid.map((r) => [r.product.id, r.entry.remainingStock]));
  const countByProduct = new Map(counts.map((c) => [c.productId, c]));

  return Promise.all(
    products
      .filter((p) => p.isActive)
      .map(async (p): Promise<ManualCountGridRow> => {
        const online = onlineByProduct.get(p.id) ?? 0;
        const offline = offlineByProduct.get(p.id) ?? 0;
        const systemRemainingStock = location === "ONLINE" ? online : location === "OFFLINE" ? offline : online + offline;

        const countCache = countByProduct.get(p.id);
        if (countCache) {
          // manualCount is non-additive (localDb.ts's own doc comment on
          // ManualCountPending) - a staged edit IS the desired absolute
          // value, not a delta to add.
          const pending = await getManualCountPending(countCache.localId);
          const manualCount = pending?.manualCount ?? countCache.manualCount;
          const variance = systemRemainingStock - manualCount;
          return {
            product: toProduct(p),
            entry: { productId: p.id, entryDate, shift, location, systemRemainingStock, manualCount, variance },
            isSaved: countCache.serverId !== null,
            isFlagged: variance !== 0,
          };
        }
        return {
          product: toProduct(p),
          entry: { productId: p.id, entryDate, shift, location, systemRemainingStock, manualCount: null, variance: null },
          isSaved: false,
          isFlagged: false,
        };
      }),
  );
}
