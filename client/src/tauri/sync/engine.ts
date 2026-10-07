// Orchestrates push-then-pull against /sync/push and /sync/pull. Goes
// through coreRequest (http.ts), not the generic request()/http.* wrapper -
// see http.ts's own comment on coreRequest for why a network failure here
// must surface as a plain error, not get caught by the generic cache/outbox.
import { coreRequest } from "../../api/http";
import {
  clearPendingManualCount,
  clearPendingOffline,
  clearPendingOnline,
  getLastSyncedAt,
  getManualCountCacheByLocalId,
  getOfflineStockCacheByLocalId,
  getOnlineStockCacheByLocalId,
  listPendingManualCounts,
  listPendingOffline,
  listPendingOnline,
  recordConflict,
  setLastSyncedAt,
  upsertManualCountFromServer,
  upsertOfflineStockFromServer,
  upsertOnlineStockFromServer,
  upsertProductsFromPull,
} from "./localDb";
import type { ManualCountCache, OfflineStockCache, OnlineStockCache, ProductCache, Shift, StockLocation, SyncTableName } from "./types";

interface PullResponse {
  serverTime: string;
  products: ProductCache[];
  onlineStock: Omit<OnlineStockCache, "localId">[];
  offlineStock: Omit<OfflineStockCache, "localId">[];
  manualCounts: Omit<ManualCountCache, "localId">[];
}

interface PushItemWire {
  tableName: SyncTableName;
  localId: string;
  productId: number;
  entryDate: string;
  shift: Shift;
  location?: StockLocation;
  baselineUpdatedAt: string | null;
  delta?: Record<string, number>;
  manualCount?: number;
}

interface PushResponse {
  applied: { localId: string; serverId: number; row: Record<string, unknown> }[];
  conflicts: { localId: string; reason: string; mine: unknown; server: unknown }[];
}

/// Pulls everything changed since our last sync and overwrites the local
/// cache with it - full overwrite per row (never merged on the pull side;
/// merging only ever happens server-side, during push-apply). A fresh UUID
/// is generated for every pulled row's local_id, but upsert*FromServer's own
/// ON CONFLICT(product_id, entry_date, shift) means a row this client
/// already has (under its own existing local_id) keeps that local_id - the
/// fresh one is simply discarded in that case, which is harmless.
export async function runPull(): Promise<void> {
  const lastSyncedAt = await getLastSyncedAt();
  // Re-read a small overlap so DB timestamp precision or two writes in the
  // same millisecond cannot leave a changed row permanently behind the
  // cursor. Upserts are idempotent, so seeing a few rows twice is safe.
  const since = lastSyncedAt
    ? new Date(new Date(lastSyncedAt).getTime() - 5_000).toISOString()
    : null;
  const qs = since ? `?since=${encodeURIComponent(since)}` : "";
  const result = await coreRequest<PullResponse>(`/sync/pull${qs}`);

  await upsertProductsFromPull(result.products);
  for (const row of result.onlineStock) await upsertOnlineStockFromServer({ ...row, localId: crypto.randomUUID() });
  for (const row of result.offlineStock) await upsertOfflineStockFromServer({ ...row, localId: crypto.randomUUID() });
  for (const row of result.manualCounts) await upsertManualCountFromServer({ ...row, localId: crypto.randomUUID() });

  await setLastSyncedAt(result.serverTime);
}

/// How many pending edits go in one /sync/push request.
///
/// sync.controller.ts caps a push body at 500 items and rejects the *whole*
/// body above that, so a device that had built up more than 500 pending
/// edits could never sync at all: every attempt failed validation and the
/// queue only ever grew. Batching keeps a large backlog draining steadily.
///
/// The size is set by the client timeout, not that cap. coreRequest aborts
/// at REQUEST_TIMEOUT_MS (4s, api/http.ts), and pushChanges applies each
/// item in its own SERIALIZABLE transaction that also walks
/// propagateOpeningStock forward - so cost is per item, not per request.
/// Measured against a seeded database (71 products, edits spread over 30
/// days): ~1.3s for 100, ~1.7s for 150, ~2.7s for 200, ~9.7s for 500. The
/// 500 the server would still accept is more than twice the client's own
/// timeout, and 200 clears it with only ~1.5x margin on a dev box with far
/// less data than production. 100 keeps ~3x headroom, which is the point:
/// a push that times out mid-batch is the expensive failure (the work is
/// already committed server-side and only replays as a no-op next sync).
export const SYNC_PUSH_BATCH_SIZE = 100;

interface PendingContext {
  tableName: SyncTableName;
  productId: number;
  entryDate: string;
  shift: Shift;
  location: StockLocation | null;
}

/// Pushes every pending offline edit. Returns how many were applied vs.
/// flagged as a conflict (see sync_conflicts / the conflicts review screen) -
/// a conflict still clears its pending row (retrying it forever wouldn't
/// change the outcome), it just doesn't update the cache with it.
export async function runPush(): Promise<{ applied: number; conflicts: number }> {
  const items: PushItemWire[] = [];
  const context = new Map<string, PendingContext>();

  for (const p of await listPendingOnline()) {
    const cache = await getOnlineStockCacheByLocalId(p.localId);
    if (!cache) continue;
    const delta: Record<string, number> = {};
    if (p.productionIn !== 0) delta.productionIn = p.productionIn;
    if (p.fulfillmentOut !== 0) delta.fulfillmentOut = p.fulfillmentOut;
    if (p.rts !== 0) delta.rts = p.rts;
    if (Object.keys(delta).length === 0) {
      await clearPendingOnline(p.localId); // net-zero edit (e.g. typed back to the original value) - nothing to push
      continue;
    }
    items.push({
      tableName: "daily_online_stock",
      localId: p.localId,
      productId: cache.productId,
      entryDate: cache.entryDate,
      shift: cache.shift,
      baselineUpdatedAt: p.baselineUpdatedAt,
      delta,
    });
    context.set(p.localId, { tableName: "daily_online_stock", productId: cache.productId, entryDate: cache.entryDate, shift: cache.shift, location: null });
  }

  for (const p of await listPendingOffline()) {
    const cache = await getOfflineStockCacheByLocalId(p.localId);
    if (!cache) continue;
    const delta: Record<string, number> = {};
    for (const field of ["productionIn", "delivery1", "delivery2", "delivery3", "delivery4", "delivery5", "backloads", "upsellOut"] as const) {
      if (p[field] !== 0) delta[field] = p[field];
    }
    if (Object.keys(delta).length === 0) {
      await clearPendingOffline(p.localId);
      continue;
    }
    items.push({
      tableName: "daily_offline_stock",
      localId: p.localId,
      productId: cache.productId,
      entryDate: cache.entryDate,
      shift: cache.shift,
      baselineUpdatedAt: p.baselineUpdatedAt,
      delta,
    });
    context.set(p.localId, { tableName: "daily_offline_stock", productId: cache.productId, entryDate: cache.entryDate, shift: cache.shift, location: null });
  }

  for (const p of await listPendingManualCounts()) {
    const cache = await getManualCountCacheByLocalId(p.localId);
    if (!cache) continue;
    items.push({
      tableName: "manual_counts",
      localId: p.localId,
      productId: cache.productId,
      entryDate: cache.entryDate,
      shift: cache.shift,
      location: cache.location,
      baselineUpdatedAt: p.baselineUpdatedAt,
      manualCount: p.manualCount,
    });
    context.set(p.localId, { tableName: "manual_counts", productId: cache.productId, entryDate: cache.entryDate, shift: cache.shift, location: cache.location });
  }

  if (items.length === 0) return { applied: 0, conflicts: 0 };

  // Drain the queue a batch at a time rather than in one request. A batch's
  // pending rows are only cleared once the server has confirmed that batch,
  // so if one fails part way through, that batch and everything after it are
  // still pending and the next sync picks them up, while the batches already
  // confirmed are not resent. Conflicts are recorded per batch too, so a
  // conflict in one does not hold up the rest.
  let applied = 0;
  let conflicts = 0;

  for (let start = 0; start < items.length; start += SYNC_PUSH_BATCH_SIZE) {
    const batch = items.slice(start, start + SYNC_PUSH_BATCH_SIZE);
    const result = await coreRequest<PushResponse>("/sync/push", { method: "POST", body: JSON.stringify({ items: batch }) });
    await applyPushResult(result, context);
    applied += result.applied.length;
    conflicts += result.conflicts.length;
  }

  return { applied, conflicts };
}

/// Commits one batch's server response locally: cached rows are overwritten
/// with what the server stored, conflicts are filed for the review screen,
/// and either way the pending row is cleared - a conflict is a final answer,
/// so retrying it forever would not change the outcome.
async function applyPushResult(result: PushResponse, context: Map<string, PendingContext>): Promise<void> {
  for (const a of result.applied) {
    const ctx = context.get(a.localId);
    if (!ctx) continue;
    if (ctx.tableName === "daily_online_stock") {
      await upsertOnlineStockFromServer({ ...(a.row as unknown as Omit<OnlineStockCache, "localId">), localId: a.localId });
      await clearPendingOnline(a.localId);
    } else if (ctx.tableName === "daily_offline_stock") {
      await upsertOfflineStockFromServer({ ...(a.row as unknown as Omit<OfflineStockCache, "localId">), localId: a.localId });
      await clearPendingOffline(a.localId);
    } else {
      await upsertManualCountFromServer({ ...(a.row as unknown as Omit<ManualCountCache, "localId">), localId: a.localId });
      await clearPendingManualCount(a.localId);
    }
  }

  for (const c of result.conflicts) {
    const ctx = context.get(c.localId);
    if (!ctx) continue;
    await recordConflict({
      tableName: ctx.tableName,
      productId: ctx.productId,
      entryDate: ctx.entryDate,
      shift: ctx.shift,
      location: ctx.location,
      reason: c.reason,
      mineValue: c.mine,
      serverValue: c.server,
      detectedAt: new Date().toISOString(),
    });
    if (ctx.tableName === "daily_online_stock") await clearPendingOnline(c.localId);
    else if (ctx.tableName === "daily_offline_stock") await clearPendingOffline(c.localId);
    else await clearPendingManualCount(c.localId);
  }
}

/// Push first, then pull - gets this client's own changes committed as
/// early as possible (minimizing what's lost if the connection drops again
/// right after), then refreshes the local cache with the now-current server
/// state, including any cascading effects (e.g. propagateOpeningStock)
/// those pushed changes triggered on other rows.
export async function runSync(): Promise<{ applied: number; conflicts: number }> {
  const pushResult = await runPush();
  await runPull();
  return pushResult;
}
