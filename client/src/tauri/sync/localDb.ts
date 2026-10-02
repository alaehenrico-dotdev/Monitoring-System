// Typed access to the local SQLite mirror (db.ts) for the three tables that
// work fully offline: DailyOnlineStock, DailyOfflineStock, ManualCount.
// Product is read-only here (see products_cache) - never staged/edited.
//
// Every table follows the same two-part shape:
//   - `*_cache`   the last-known server truth for a row (our merge baseline)
//   - `*_pending` this client's own desired DELTA (additive fields) or
//                 desired absolute value (non-additive - manual_counts) for
//                 whatever hasn't been pushed yet
//
// A pending row is recomputed (not accumulated) on every local edit, always
// relative to `cache` - cache never changes between edits while offline (no
// pulls happen offline), so re-deriving the delta fresh each time is both
// correct and idempotent. See TAURI_SETUP.md's offline-sync section for the
// full reasoning on why additive fields are summed server-side rather than
// computed as a final value here.
import { getDb } from "../db";
import type {
  ManualCountCache,
  ManualCountPending,
  OfflineStockCache,
  OfflineStockPending,
  OnlineStockCache,
  OnlineStockPending,
  ProductCache,
  Shift,
  StockLocation,
  SyncConflict,
  SyncTableName,
} from "./types";

function nowIso(): string {
  return new Date().toISOString();
}

// ---------------------------------------------------------------------------
// sync_meta - this install's identity + cursor
// ---------------------------------------------------------------------------

export async function getClientId(): Promise<string> {
  const db = await getDb();
  const rows = await db.select<{ client_id: string }[]>("SELECT client_id FROM sync_meta WHERE id = 1");
  if (rows.length > 0) return rows[0].client_id;
  const clientId = crypto.randomUUID();
  await db.execute("INSERT INTO sync_meta (id, client_id, last_synced_at) VALUES (1, $1, NULL)", [clientId]);
  return clientId;
}

export async function getLastSyncedAt(): Promise<string | null> {
  const db = await getDb();
  const rows = await db.select<{ last_synced_at: string | null }[]>("SELECT last_synced_at FROM sync_meta WHERE id = 1");
  return rows[0]?.last_synced_at ?? null;
}

export async function setLastSyncedAt(iso: string): Promise<void> {
  const db = await getDb();
  await db.execute("UPDATE sync_meta SET last_synced_at = $1 WHERE id = 1", [iso]);
}

// ---------------------------------------------------------------------------
// products_cache - read-only mirror
// ---------------------------------------------------------------------------

function rowToProduct(r: Record<string, unknown>): ProductCache {
  return {
    id: r.id as number,
    sku: r.sku as string | null,
    name: r.name as string,
    category: r.category as string,
    unit: r.unit as string,
    isActive: Boolean(r.is_active),
    sortOrder: r.sort_order as number,
    lowStockThreshold: r.low_stock_threshold as number | null,
    updatedAt: r.updated_at as string,
  };
}

export async function listProductsCache(): Promise<ProductCache[]> {
  const db = await getDb();
  const rows = await db.select<Record<string, unknown>[]>("SELECT * FROM products_cache ORDER BY sort_order ASC");
  return rows.map(rowToProduct);
}

/// Called from the sync engine's pull step - a product mirror is always a
/// full overwrite (never merged, never locally edited).
export async function upsertProductsFromPull(products: ProductCache[]): Promise<void> {
  const db = await getDb();
  for (const p of products) {
    await db.execute(
      `INSERT INTO products_cache (id, sku, name, category, unit, is_active, sort_order, low_stock_threshold, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       ON CONFLICT(id) DO UPDATE SET
         sku = $2, name = $3, category = $4, unit = $5, is_active = $6,
         sort_order = $7, low_stock_threshold = $8, updated_at = $9`,
      [p.id, p.sku, p.name, p.category, p.unit, p.isActive ? 1 : 0, p.sortOrder, p.lowStockThreshold, p.updatedAt],
    );
  }
}

// ---------------------------------------------------------------------------
// daily_online_stock
// ---------------------------------------------------------------------------

function rowToOnline(r: Record<string, unknown>): OnlineStockCache {
  return {
    localId: r.local_id as string,
    serverId: r.server_id as number | null,
    productId: r.product_id as number,
    entryDate: r.entry_date as string,
    shift: r.shift as Shift,
    openingStock: r.opening_stock as number,
    stockInOffToOl: r.stock_in_off_to_ol as number,
    stockOutOlToOff: r.stock_out_ol_to_off as number,
    onlineStock: r.online_stock as number,
    productionIn: r.production_in as number,
    fulfillmentOut: r.fulfillment_out as number,
    rts: r.rts as number,
    remainingStock: r.remaining_stock as number,
    encodedById: r.encoded_by_id as number | null,
    updatedAt: r.updated_at as string,
  };
}

export async function getOnlineStockCache(productId: number, entryDate: string, shift: Shift): Promise<OnlineStockCache | null> {
  const db = await getDb();
  const rows = await db.select<Record<string, unknown>[]>(
    "SELECT * FROM daily_online_stock_cache WHERE product_id = $1 AND entry_date = $2 AND shift = $3",
    [productId, entryDate, shift],
  );
  return rows.length ? rowToOnline(rows[0]) : null;
}

/// Used by the sync engine to build a push item from a pending row, which
/// only has local_id - not product/date/shift - of its own.
export async function getOnlineStockCacheByLocalId(localId: string): Promise<OnlineStockCache | null> {
  const db = await getDb();
  const rows = await db.select<Record<string, unknown>[]>("SELECT * FROM daily_online_stock_cache WHERE local_id = $1", [localId]);
  return rows.length ? rowToOnline(rows[0]) : null;
}

export async function listOnlineStockCacheForDate(entryDate: string, shift: Shift): Promise<OnlineStockCache[]> {
  const db = await getDb();
  const rows = await db.select<Record<string, unknown>[]>(
    "SELECT * FROM daily_online_stock_cache WHERE entry_date = $1 AND shift = $2",
    [entryDate, shift],
  );
  return rows.map(rowToOnline);
}

/// Best-effort local preview of Section 4.6's carry-forward - the most
/// recent earlier cache row's remainingStock, or a manual count that
/// supersedes it, same comparison the server uses
/// (dailyOnlineStockRepository.getOpeningStock) but only ever sees what this
/// client has locally mirrored. This is ONLY for showing a reasonable
/// starting figure while offline - the server recomputes the authoritative
/// value on every sync, so a locally-missing row (e.g. another client's
/// not-yet-pulled entry) can make this preview wrong until the next sync.
/// Same ordering stockMath.ts's periodRank gives server-side: later date
/// wins, and within the same date NIGHT > MORNING.
function rank(entryDate: string, shift: Shift): number {
  return new Date(entryDate).getTime() * 2 + (shift === "NIGHT" ? 1 : 0);
}

async function getLocalOpeningStockOnline(productId: number, entryDate: string, shift: Shift): Promise<number> {
  const db = await getDb();
  const priorRows = await db.select<{ remaining_stock: number; entry_date: string; shift: Shift }[]>(
    `SELECT remaining_stock, entry_date, shift FROM daily_online_stock_cache
     WHERE product_id = $1 AND (entry_date < $2 OR (entry_date = $2 AND shift = 'MORNING' AND $3 = 'NIGHT'))
     ORDER BY entry_date DESC, shift DESC LIMIT 1`,
    [productId, entryDate, shift],
  );
  const countRows = await db.select<{ manual_count: number; entry_date: string; shift: Shift }[]>(
    `SELECT manual_count, entry_date, shift FROM manual_counts_cache
     WHERE product_id = $1 AND location = 'ONLINE' AND (entry_date < $2 OR (entry_date = $2 AND shift = 'MORNING' AND $3 = 'NIGHT'))
     ORDER BY entry_date DESC, shift DESC LIMIT 1`,
    [productId, entryDate, shift],
  );
  const prior = priorRows[0] ?? null;
  const count = countRows[0] ?? null;
  if (count && (!prior || rank(count.entry_date, count.shift) >= rank(prior.entry_date, prior.shift))) {
    return count.manual_count;
  }
  return prior?.remaining_stock ?? 0;
}

/// Writes the server's authoritative row into cache - called after a pull,
/// or after this client's own push is acknowledged. Always wins outright
/// (this IS the new baseline); any pending delta for this row should be
/// cleared by the caller once its push has been confirmed applied.
export async function upsertOnlineStockFromServer(row: OnlineStockCache): Promise<void> {
  const db = await getDb();
  await db.execute(
    `INSERT INTO daily_online_stock_cache
       (local_id, server_id, product_id, entry_date, shift, opening_stock, stock_in_off_to_ol, stock_out_ol_to_off,
        online_stock, production_in, fulfillment_out, rts, remaining_stock, encoded_by_id, updated_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)
     ON CONFLICT(product_id, entry_date, shift) DO UPDATE SET
       server_id=$2, opening_stock=$6, stock_in_off_to_ol=$7, stock_out_ol_to_off=$8, online_stock=$9,
       production_in=$10, fulfillment_out=$11, rts=$12, remaining_stock=$13, encoded_by_id=$14, updated_at=$15`,
    [
      row.localId, row.serverId, row.productId, row.entryDate, row.shift, row.openingStock,
      row.stockInOffToOl, row.stockOutOlToOff, row.onlineStock, row.productionIn, row.fulfillmentOut,
      row.rts, row.remainingStock, row.encodedById, row.updatedAt,
    ],
  );
}

export async function getOnlineStockPending(localId: string): Promise<OnlineStockPending | null> {
  const db = await getDb();
  const rows = await db.select<Record<string, unknown>[]>("SELECT * FROM daily_online_stock_pending WHERE local_id = $1", [localId]);
  if (!rows.length) return null;
  const r = rows[0];
  return {
    localId: r.local_id as string,
    productionIn: r.production_in as number,
    fulfillmentOut: r.fulfillment_out as number,
    rts: r.rts as number,
    baselineUpdatedAt: r.baseline_updated_at as string | null,
    stagedAt: r.staged_at as string,
  };
}

export async function listPendingOnline(): Promise<OnlineStockPending[]> {
  const db = await getDb();
  const rows = await db.select<Record<string, unknown>[]>("SELECT * FROM daily_online_stock_pending");
  return rows.map((r) => ({
    localId: r.local_id as string,
    productionIn: r.production_in as number,
    fulfillmentOut: r.fulfillment_out as number,
    rts: r.rts as number,
    baselineUpdatedAt: r.baseline_updated_at as string | null,
    stagedAt: r.staged_at as string,
  }));
}

export async function clearPendingOnline(localId: string): Promise<void> {
  const db = await getDb();
  await db.execute("DELETE FROM daily_online_stock_pending WHERE local_id = $1", [localId]);
}

/// Stages an offline edit to one of the three additive Online fields - only
/// ever called with the fields that are actually editable while offline
/// (productionIn/fulfillmentOut/rts; the transfer fields are disabled in the
/// UI offline, see Layout/OnlineEntryPage). `desired` is the ABSOLUTE value
/// the user just typed (how the UI naturally works), not a delta - this
/// derives the delta against the cache baseline and overwrites (not
/// accumulates) the pending row, so editing the same cell twice offline
/// doesn't double-count.
export async function stageOnlineEdit(
  productId: number,
  entryDate: string,
  shift: Shift,
  desired: Partial<{ productionIn: number; fulfillmentOut: number; rts: number }>,
): Promise<OnlineStockCache> {
  const db = await getDb();
  let cache = await getOnlineStockCache(productId, entryDate, shift);
  if (!cache) {
    const openingStock = await getLocalOpeningStockOnline(productId, entryDate, shift);
    cache = {
      localId: crypto.randomUUID(),
      serverId: null,
      productId,
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
      encodedById: null,
      updatedAt: nowIso(),
    };
    await upsertOnlineStockFromServer(cache);
  }

  const existingPending = await getOnlineStockPending(cache.localId);
  const currentDesired = {
    productionIn: cache.productionIn + (existingPending?.productionIn ?? 0),
    fulfillmentOut: cache.fulfillmentOut + (existingPending?.fulfillmentOut ?? 0),
    rts: cache.rts + (existingPending?.rts ?? 0),
  };
  const nextDesired = { ...currentDesired, ...desired };
  const pending = {
    productionIn: nextDesired.productionIn - cache.productionIn,
    fulfillmentOut: nextDesired.fulfillmentOut - cache.fulfillmentOut,
    rts: nextDesired.rts - cache.rts,
  };

  await db.execute(
    `INSERT INTO daily_online_stock_pending (local_id, production_in, fulfillment_out, rts, baseline_updated_at, staged_at)
     VALUES ($1,$2,$3,$4,$5,$6)
     ON CONFLICT(local_id) DO UPDATE SET production_in=$2, fulfillment_out=$3, rts=$4, baseline_updated_at=$5, staged_at=$6`,
    [cache.localId, pending.productionIn, pending.fulfillmentOut, pending.rts, cache.updatedAt, nowIso()],
  );

  // Locally-recomputed preview only (openingStock unchanged - this client
  // doesn't know if a transfer or another client's save shifted it; the
  // server recomputes the real value on sync). Derived fields here are
  // provisional, same caveat as getLocalOpeningStockOnline above.
  const onlineStock = cache.openingStock + cache.stockInOffToOl - cache.stockOutOlToOff;
  const remainingStock = onlineStock + nextDesired.productionIn - nextDesired.fulfillmentOut + nextDesired.rts;
  return { ...cache, ...nextDesired, onlineStock, remainingStock };
}

// ---------------------------------------------------------------------------
// daily_offline_stock
// ---------------------------------------------------------------------------

function rowToOffline(r: Record<string, unknown>): OfflineStockCache {
  return {
    localId: r.local_id as string,
    serverId: r.server_id as number | null,
    productId: r.product_id as number,
    entryDate: r.entry_date as string,
    shift: r.shift as Shift,
    openingStock: r.opening_stock as number,
    stockInOlToOff: r.stock_in_ol_to_off as number,
    stockOutOffToOl: r.stock_out_off_to_ol as number,
    offlineStock: r.offline_stock as number,
    productionIn: r.production_in as number,
    deliveryOut: r.delivery_out as number,
    delivery1: r.delivery1 as number,
    delivery2: r.delivery2 as number,
    delivery3: r.delivery3 as number,
    delivery4: r.delivery4 as number,
    delivery5: r.delivery5 as number,
    backloads: r.backloads as number,
    upsellOut: r.upsell_out as number,
    remainingStock: r.remaining_stock as number,
    encodedById: r.encoded_by_id as number | null,
    updatedAt: r.updated_at as string,
  };
}

export async function getOfflineStockCache(productId: number, entryDate: string, shift: Shift): Promise<OfflineStockCache | null> {
  const db = await getDb();
  const rows = await db.select<Record<string, unknown>[]>(
    "SELECT * FROM daily_offline_stock_cache WHERE product_id = $1 AND entry_date = $2 AND shift = $3",
    [productId, entryDate, shift],
  );
  return rows.length ? rowToOffline(rows[0]) : null;
}

export async function getOfflineStockCacheByLocalId(localId: string): Promise<OfflineStockCache | null> {
  const db = await getDb();
  const rows = await db.select<Record<string, unknown>[]>("SELECT * FROM daily_offline_stock_cache WHERE local_id = $1", [localId]);
  return rows.length ? rowToOffline(rows[0]) : null;
}

export async function listOfflineStockCacheForDate(entryDate: string, shift: Shift): Promise<OfflineStockCache[]> {
  const db = await getDb();
  const rows = await db.select<Record<string, unknown>[]>(
    "SELECT * FROM daily_offline_stock_cache WHERE entry_date = $1 AND shift = $2",
    [entryDate, shift],
  );
  return rows.map(rowToOffline);
}

async function getLocalOpeningStockOffline(productId: number, entryDate: string, shift: Shift): Promise<number> {
  const db = await getDb();
  const priorRows = await db.select<{ remaining_stock: number; entry_date: string; shift: Shift }[]>(
    `SELECT remaining_stock, entry_date, shift FROM daily_offline_stock_cache
     WHERE product_id = $1 AND (entry_date < $2 OR (entry_date = $2 AND shift = 'MORNING' AND $3 = 'NIGHT'))
     ORDER BY entry_date DESC, shift DESC LIMIT 1`,
    [productId, entryDate, shift],
  );
  const countRows = await db.select<{ manual_count: number; entry_date: string; shift: Shift }[]>(
    `SELECT manual_count, entry_date, shift FROM manual_counts_cache
     WHERE product_id = $1 AND location = 'OFFLINE' AND (entry_date < $2 OR (entry_date = $2 AND shift = 'MORNING' AND $3 = 'NIGHT'))
     ORDER BY entry_date DESC, shift DESC LIMIT 1`,
    [productId, entryDate, shift],
  );
  const prior = priorRows[0] ?? null;
  const count = countRows[0] ?? null;
  if (count && (!prior || rank(count.entry_date, count.shift) >= rank(prior.entry_date, prior.shift))) {
    return count.manual_count;
  }
  return prior?.remaining_stock ?? 0;
}

export async function upsertOfflineStockFromServer(row: OfflineStockCache): Promise<void> {
  const db = await getDb();
  await db.execute(
    `INSERT INTO daily_offline_stock_cache
       (local_id, server_id, product_id, entry_date, shift, opening_stock, stock_in_ol_to_off, stock_out_off_to_ol,
        offline_stock, production_in, delivery_out, delivery1, delivery2, delivery3, delivery4, delivery5,
        backloads, upsell_out, remaining_stock, encoded_by_id, updated_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21)
     ON CONFLICT(product_id, entry_date, shift) DO UPDATE SET
       server_id=$2, opening_stock=$6, stock_in_ol_to_off=$7, stock_out_off_to_ol=$8, offline_stock=$9,
       production_in=$10, delivery_out=$11, delivery1=$12, delivery2=$13, delivery3=$14, delivery4=$15,
       delivery5=$16, backloads=$17, upsell_out=$18, remaining_stock=$19, encoded_by_id=$20, updated_at=$21`,
    [
      row.localId, row.serverId, row.productId, row.entryDate, row.shift, row.openingStock,
      row.stockInOlToOff, row.stockOutOffToOl, row.offlineStock, row.productionIn, row.deliveryOut,
      row.delivery1, row.delivery2, row.delivery3, row.delivery4, row.delivery5, row.backloads,
      row.upsellOut, row.remainingStock, row.encodedById, row.updatedAt,
    ],
  );
}

export async function getOfflineStockPending(localId: string): Promise<OfflineStockPending | null> {
  const db = await getDb();
  const rows = await db.select<Record<string, unknown>[]>("SELECT * FROM daily_offline_stock_pending WHERE local_id = $1", [localId]);
  if (!rows.length) return null;
  const r = rows[0];
  return {
    localId: r.local_id as string,
    productionIn: r.production_in as number,
    delivery1: r.delivery1 as number,
    delivery2: r.delivery2 as number,
    delivery3: r.delivery3 as number,
    delivery4: r.delivery4 as number,
    delivery5: r.delivery5 as number,
    backloads: r.backloads as number,
    upsellOut: r.upsell_out as number,
    baselineUpdatedAt: r.baseline_updated_at as string | null,
    stagedAt: r.staged_at as string,
  };
}

export async function listPendingOffline(): Promise<OfflineStockPending[]> {
  const db = await getDb();
  const rows = await db.select<Record<string, unknown>[]>("SELECT * FROM daily_offline_stock_pending");
  return rows.map((r) => ({
    localId: r.local_id as string,
    productionIn: r.production_in as number,
    delivery1: r.delivery1 as number,
    delivery2: r.delivery2 as number,
    delivery3: r.delivery3 as number,
    delivery4: r.delivery4 as number,
    delivery5: r.delivery5 as number,
    backloads: r.backloads as number,
    upsellOut: r.upsell_out as number,
    baselineUpdatedAt: r.baseline_updated_at as string | null,
    stagedAt: r.staged_at as string,
  }));
}

export async function clearPendingOffline(localId: string): Promise<void> {
  const db = await getDb();
  await db.execute("DELETE FROM daily_offline_stock_pending WHERE local_id = $1", [localId]);
}

const OFFLINE_ADDITIVE_FIELDS = ["productionIn", "delivery1", "delivery2", "delivery3", "delivery4", "delivery5", "backloads", "upsellOut"] as const;
type OfflineAdditiveField = (typeof OFFLINE_ADDITIVE_FIELDS)[number];

export async function stageOfflineEdit(
  productId: number,
  entryDate: string,
  shift: Shift,
  desired: Partial<Record<OfflineAdditiveField, number>>,
): Promise<OfflineStockCache> {
  const db = await getDb();
  let cache = await getOfflineStockCache(productId, entryDate, shift);
  if (!cache) {
    const openingStock = await getLocalOpeningStockOffline(productId, entryDate, shift);
    cache = {
      localId: crypto.randomUUID(),
      serverId: null,
      productId,
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
      backloads: 0,
      upsellOut: 0,
      remainingStock: openingStock,
      encodedById: null,
      updatedAt: nowIso(),
    };
    await upsertOfflineStockFromServer(cache);
  }

  const existingPending = await getOfflineStockPending(cache.localId);
  const currentDesired = Object.fromEntries(
    OFFLINE_ADDITIVE_FIELDS.map((f) => [f, cache![f] + (existingPending?.[f] ?? 0)]),
  ) as Record<OfflineAdditiveField, number>;
  const nextDesired = { ...currentDesired, ...desired };
  const pending = Object.fromEntries(OFFLINE_ADDITIVE_FIELDS.map((f) => [f, nextDesired[f] - cache![f]])) as Record<
    OfflineAdditiveField,
    number
  >;

  await db.execute(
    `INSERT INTO daily_offline_stock_pending
       (local_id, production_in, delivery1, delivery2, delivery3, delivery4, delivery5, backloads, upsell_out, baseline_updated_at, staged_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
     ON CONFLICT(local_id) DO UPDATE SET
       production_in=$2, delivery1=$3, delivery2=$4, delivery3=$5, delivery4=$6, delivery5=$7,
       backloads=$8, upsell_out=$9, baseline_updated_at=$10, staged_at=$11`,
    [
      cache.localId, pending.productionIn, pending.delivery1, pending.delivery2, pending.delivery3,
      pending.delivery4, pending.delivery5, pending.backloads, pending.upsellOut, cache.updatedAt, nowIso(),
    ],
  );

  const deliveryOut = nextDesired.delivery1 + nextDesired.delivery2 + nextDesired.delivery3 + nextDesired.delivery4 + nextDesired.delivery5;
  const offlineStock = cache.openingStock + cache.stockInOlToOff - cache.stockOutOffToOl;
  const remainingStock = offlineStock + nextDesired.productionIn - deliveryOut - nextDesired.upsellOut + nextDesired.backloads;
  return { ...cache, ...nextDesired, deliveryOut, offlineStock, remainingStock };
}

// ---------------------------------------------------------------------------
// manual_counts
// ---------------------------------------------------------------------------

function rowToManualCount(r: Record<string, unknown>): ManualCountCache {
  return {
    localId: r.local_id as string,
    serverId: r.server_id as number | null,
    productId: r.product_id as number,
    entryDate: r.entry_date as string,
    shift: r.shift as Shift,
    location: r.location as StockLocation,
    systemRemainingStock: r.system_remaining_stock as number,
    manualCount: r.manual_count as number,
    variance: r.variance as number,
    countedById: r.counted_by_id as number | null,
    updatedAt: r.updated_at as string,
  };
}

export async function getManualCountCache(
  productId: number,
  entryDate: string,
  shift: Shift,
  location: StockLocation,
): Promise<ManualCountCache | null> {
  const db = await getDb();
  const rows = await db.select<Record<string, unknown>[]>(
    "SELECT * FROM manual_counts_cache WHERE product_id = $1 AND entry_date = $2 AND shift = $3 AND location = $4",
    [productId, entryDate, shift, location],
  );
  return rows.length ? rowToManualCount(rows[0]) : null;
}

export async function getManualCountCacheByLocalId(localId: string): Promise<ManualCountCache | null> {
  const db = await getDb();
  const rows = await db.select<Record<string, unknown>[]>("SELECT * FROM manual_counts_cache WHERE local_id = $1", [localId]);
  return rows.length ? rowToManualCount(rows[0]) : null;
}

export async function upsertManualCountFromServer(row: ManualCountCache): Promise<void> {
  const db = await getDb();
  await db.execute(
    `INSERT INTO manual_counts_cache
       (local_id, server_id, product_id, entry_date, shift, location, system_remaining_stock, manual_count, variance, counted_by_id, updated_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
     ON CONFLICT(product_id, entry_date, shift, location) DO UPDATE SET
       server_id=$2, system_remaining_stock=$7, manual_count=$8, variance=$9, counted_by_id=$10, updated_at=$11`,
    [
      row.localId, row.serverId, row.productId, row.entryDate, row.shift, row.location,
      row.systemRemainingStock, row.manualCount, row.variance, row.countedById, row.updatedAt,
    ],
  );
}

export async function getManualCountPending(localId: string): Promise<ManualCountPending | null> {
  const db = await getDb();
  const rows = await db.select<Record<string, unknown>[]>("SELECT * FROM manual_counts_pending WHERE local_id = $1", [localId]);
  if (!rows.length) return null;
  const r = rows[0];
  return {
    localId: r.local_id as string,
    manualCount: r.manual_count as number,
    baselineUpdatedAt: r.baseline_updated_at as string | null,
    stagedAt: r.staged_at as string,
  };
}

export async function listPendingManualCounts(): Promise<ManualCountPending[]> {
  const db = await getDb();
  const rows = await db.select<Record<string, unknown>[]>("SELECT * FROM manual_counts_pending");
  return rows.map((r) => ({
    localId: r.local_id as string,
    manualCount: r.manual_count as number,
    baselineUpdatedAt: r.baseline_updated_at as string | null,
    stagedAt: r.staged_at as string,
  }));
}

export async function clearPendingManualCount(localId: string): Promise<void> {
  const db = await getDb();
  await db.execute("DELETE FROM manual_counts_pending WHERE local_id = $1", [localId]);
}

/// manualCount is NON-additive (Section 4.4: a physical count, not an
/// event) - pending stores the desired absolute value directly, overwriting
/// any earlier offline edit to the same cell, same as the online/server
/// grid already does for an unsynced edit.
export async function stageManualCount(
  productId: number,
  entryDate: string,
  shift: Shift,
  location: StockLocation,
  systemRemainingStock: number,
  manualCount: number,
): Promise<ManualCountCache> {
  let cache = await getManualCountCache(productId, entryDate, shift, location);
  if (!cache) {
    cache = {
      localId: crypto.randomUUID(),
      serverId: null,
      productId,
      entryDate,
      shift,
      location,
      systemRemainingStock,
      manualCount: 0,
      variance: 0,
      countedById: null,
      updatedAt: nowIso(),
    };
    await upsertManualCountFromServer(cache);
  }

  const db = await getDb();
  await db.execute(
    `INSERT INTO manual_counts_pending (local_id, manual_count, baseline_updated_at, staged_at)
     VALUES ($1,$2,$3,$4)
     ON CONFLICT(local_id) DO UPDATE SET manual_count=$2, baseline_updated_at=$3, staged_at=$4`,
    [cache.localId, manualCount, cache.updatedAt, nowIso()],
  );

  const variance = systemRemainingStock - manualCount;
  return { ...cache, systemRemainingStock, manualCount, variance };
}

// ---------------------------------------------------------------------------
// sync_conflicts
// ---------------------------------------------------------------------------

export async function recordConflict(conflict: Omit<SyncConflict, "id" | "resolved">): Promise<void> {
  const db = await getDb();
  await db.execute(
    `INSERT INTO sync_conflicts (table_name, product_id, entry_date, shift, location, reason, mine_value, server_value, detected_at, resolved)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,0)`,
    [
      conflict.tableName, conflict.productId, conflict.entryDate, conflict.shift, conflict.location, conflict.reason,
      JSON.stringify(conflict.mineValue), JSON.stringify(conflict.serverValue), conflict.detectedAt,
    ],
  );
}

export async function listUnresolvedConflicts(): Promise<SyncConflict[]> {
  const db = await getDb();
  const rows = await db.select<Record<string, unknown>[]>("SELECT * FROM sync_conflicts WHERE resolved = 0 ORDER BY detected_at ASC");
  return rows.map((r) => ({
    id: r.id as number,
    tableName: r.table_name as SyncTableName,
    productId: r.product_id as number,
    entryDate: r.entry_date as string,
    shift: r.shift as Shift,
    location: r.location as StockLocation | null,
    reason: r.reason as string,
    mineValue: JSON.parse(r.mine_value as string),
    serverValue: JSON.parse(r.server_value as string),
    detectedAt: r.detected_at as string,
    resolved: Boolean(r.resolved),
  }));
}

export async function resolveConflict(id: number): Promise<void> {
  const db = await getDb();
  await db.execute("UPDATE sync_conflicts SET resolved = 1 WHERE id = $1", [id]);
}

export async function countUnresolvedConflicts(): Promise<number> {
  const db = await getDb();
  const rows = await db.select<{ count: number }[]>("SELECT COUNT(*) as count FROM sync_conflicts WHERE resolved = 0");
  return rows[0]?.count ?? 0;
}

/// Combined count across all three pending tables - what the sync badge
/// shows (how many offline edits are still waiting to reach the server).
export async function countPendingSyncChanges(): Promise<number> {
  const db = await getDb();
  const rows = await db.select<{ count: number }[]>(
    `SELECT
       (SELECT COUNT(*) FROM daily_online_stock_pending) +
       (SELECT COUNT(*) FROM daily_offline_stock_pending) +
       (SELECT COUNT(*) FROM manual_counts_pending) AS count`,
  );
  return rows[0]?.count ?? 0;
}
