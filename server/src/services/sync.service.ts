import { Shift, StockLocation } from "@prisma/client";
import { prisma, serializableTransaction, type Db } from "../lib/prisma";
import { dailyOnlineStockRepository } from "../repositories/dailyOnlineStockRepository";
import { dailyOfflineStockRepository } from "../repositories/dailyOfflineStockRepository";
import { manualCountRepository } from "../repositories/manualCountRepository";
import { productRepository } from "../repositories/productRepository";
import { saveOnlineEntry } from "./dailyOnlineStock.service";
import { saveOfflineEntry } from "./dailyOfflineStock.service";
import { saveManualCount } from "./manualCounts.service";
import { broadcastRealtimeEvent } from "../lib/realtime";
import { HttpError } from "../utils/HttpError";
import { toNum } from "../utils/stockMath";
import { toDateOnlyString } from "../utils/date";

/**
 * Desktop app offline sync (client/src/tauri/sync). Two endpoints:
 *
 * - pullChanges: "everything that's changed since my last sync" - read
 *   straight from each mirrored table's own `updatedAt` (indexed - see the
 *   schema migration 20261002014429), not ChangeLog, which only stores
 *   full-row audit snapshots and isn't structured for cursor queries.
 *
 * - pushChanges: applies a batch of offline-made edits. Additive fields
 *   (productionIn, fulfillmentOut, rts, delivery1-5, backloads, upsellOut)
 *   are summed onto whatever the server's CURRENT value is - each offline
 *   client's delta is an independent event, order doesn't matter. Every
 *   apply goes through the real saveOnlineEntry/saveOfflineEntry/
 *   saveManualCount - never reimplemented here - so the existing negative-
 *   stock guard, cross-table transfer mirroring, and manual-count
 *   propagation chain all still run exactly as they do for a live save.
 *   manualCount is NOT additive (a physical count, not an event) - a
 *   genuine conflict (server changed since this client's baseline AND the
 *   values actually differ) is reported, never silently overwritten.
 *
 *   Idempotent per item, keyed by each item's client-generated `localId`
 *   (SyncPushApplication - schema.prisma): a client that never saw a push
 *   attempt's response (request timeout, dropped connection after the
 *   server already committed) retries with that SAME localId rather than
 *   minting a new one. Without this, that retry would sum the same additive
 *   delta onto the server's value a second time, silently inflating it -
 *   exactly the class of bug an "offline-first, no data lost" app can't
 *   afford. The idempotency marker is written in the SAME transaction as
 *   the delta it guards (saveOnlineEntry/saveOfflineEntry/saveManualCount
 *   all accept an external `db` for exactly this), so a crash between
 *   applying a delta and recording that it was applied can't happen - either
 *   both commit or neither does. A retry that finds its localId already
 *   recorded skips straight to reporting the row as it stands now.
 */

export interface PullResult {
  serverTime: string;
  products: {
    id: number;
    sku: string | null;
    name: string;
    category: string;
    unit: string;
    isActive: boolean;
    sortOrder: number;
    lowStockThreshold: number | null;
    updatedAt: string;
  }[];
  onlineStock: ReturnType<typeof serializeOnline>[];
  offlineStock: ReturnType<typeof serializeOffline>[];
  manualCounts: ReturnType<typeof serializeManualCount>[];
}

function serializeOnline(r: NonNullable<Awaited<ReturnType<typeof dailyOnlineStockRepository.findByProductAndDate>>>) {
  return {
    serverId: r.id,
    productId: r.productId,
    entryDate: toDateOnlyString(r.entryDate),
    shift: r.shift,
    openingStock: toNum(r.openingStock),
    stockInOffToOl: toNum(r.stockInOffToOl),
    stockOutOlToOff: toNum(r.stockOutOlToOff),
    onlineStock: toNum(r.onlineStock),
    productionIn: toNum(r.productionIn),
    fulfillmentOut: toNum(r.fulfillmentOut),
    rts: toNum(r.rts),
    remainingStock: toNum(r.remainingStock),
    encodedById: r.encodedById,
    updatedAt: r.updatedAt.toISOString(),
  };
}

function serializeOffline(r: NonNullable<Awaited<ReturnType<typeof dailyOfflineStockRepository.findByProductAndDate>>>) {
  return {
    serverId: r.id,
    productId: r.productId,
    entryDate: toDateOnlyString(r.entryDate),
    shift: r.shift,
    openingStock: toNum(r.openingStock),
    stockInOlToOff: toNum(r.stockInOlToOff),
    stockOutOffToOl: toNum(r.stockOutOffToOl),
    offlineStock: toNum(r.offlineStock),
    productionIn: toNum(r.productionIn),
    deliveryOut: toNum(r.deliveryOut),
    delivery1: toNum(r.delivery1),
    delivery2: toNum(r.delivery2),
    delivery3: toNum(r.delivery3),
    delivery4: toNum(r.delivery4),
    delivery5: toNum(r.delivery5),
    backloads: toNum(r.backloads),
    upsellOut: toNum(r.upsellOut),
    remainingStock: toNum(r.remainingStock),
    encodedById: r.encodedById,
    updatedAt: r.updatedAt.toISOString(),
  };
}

function serializeManualCount(r: { id: number; productId: number; entryDate: Date; shift: Shift; location: StockLocation; systemRemainingStock: unknown; manualCount: unknown; variance: unknown; countedById: number | null; updatedAt: Date }) {
  return {
    serverId: r.id,
    productId: r.productId,
    entryDate: toDateOnlyString(r.entryDate),
    shift: r.shift,
    location: r.location,
    systemRemainingStock: toNum(r.systemRemainingStock),
    manualCount: toNum(r.manualCount),
    variance: toNum(r.variance),
    countedById: r.countedById,
    updatedAt: r.updatedAt.toISOString(),
  };
}

export async function pullChanges(since: Date | null): Promise<PullResult> {
  // Captured before the queries run, not after - a row that changes DURING
  // this pull is safer to see again on the NEXT pull (since > this moment)
  // than to risk missing it because it slipped in after this query ran but
  // before `serverTime` was recorded.
  const serverTime = new Date();
  const where = since ? { updatedAt: { gt: since } } : {};

  const [products, onlineRows, offlineRows, manualCountRows] = await Promise.all([
    prisma.product.findMany({ where }),
    prisma.dailyOnlineStock.findMany({ where }),
    prisma.dailyOfflineStock.findMany({ where }),
    prisma.manualCount.findMany({ where }),
  ]);

  return {
    serverTime: serverTime.toISOString(),
    products: products.map((p) => ({
      id: p.id,
      sku: p.sku,
      name: p.name,
      category: p.category,
      unit: p.unit,
      isActive: p.isActive,
      sortOrder: p.sortOrder,
      lowStockThreshold: p.lowStockThreshold === null ? null : toNum(p.lowStockThreshold),
      updatedAt: p.updatedAt.toISOString(),
    })),
    onlineStock: onlineRows.map(serializeOnline),
    offlineStock: offlineRows.map(serializeOffline),
    manualCounts: manualCountRows.map(serializeManualCount),
  };
}

const ONLINE_ADDITIVE_FIELDS = ["productionIn", "fulfillmentOut", "rts"] as const;
const OFFLINE_ADDITIVE_FIELDS = ["productionIn", "delivery1", "delivery2", "delivery3", "delivery4", "delivery5", "backloads", "upsellOut"] as const;

export interface PushItem {
  tableName: "daily_online_stock" | "daily_offline_stock" | "manual_counts";
  localId: string;
  productId: number;
  entryDate: string;
  shift: Shift;
  location?: StockLocation;
  baselineUpdatedAt: string | null;
  delta?: Partial<Record<string, number>>;
  manualCount?: number;
}

export interface PushApplied {
  localId: string;
  serverId: number;
  row: unknown;
}

export interface PushConflict {
  localId: string;
  reason: string;
  mine: unknown;
  server: unknown;
}

export interface PushResult {
  applied: PushApplied[];
  conflicts: PushConflict[];
}

/// Re-reads the row a PRIOR push attempt already applied, by its serverId -
/// used when this item's localId is found already recorded (see
/// pushChanges): the delta must NOT be re-applied, but the response still
/// needs to look like a normal "applied" result so the client clears its
/// pending row the same way it would have the first time.
async function fetchAppliedRow(tx: Db, tableName: PushItem["tableName"], serverId: number) {
  if (tableName === "daily_online_stock") {
    return serializeOnline(await tx.dailyOnlineStock.findUniqueOrThrow({ where: { id: serverId } }));
  }
  if (tableName === "daily_offline_stock") {
    return serializeOffline(await tx.dailyOfflineStock.findUniqueOrThrow({ where: { id: serverId } }));
  }
  return serializeManualCount(await tx.manualCount.findUniqueOrThrow({ where: { id: serverId } }));
}

type ItemOutcome =
  | { kind: "applied"; serverId: number; row: unknown; replay: boolean }
  | { kind: "conflict"; reason: string; mine: unknown; server: unknown };

export async function pushChanges(items: PushItem[], userId?: number): Promise<PushResult> {
  const applied: PushApplied[] = [];
  const conflicts: PushConflict[] = [];

  for (const item of items) {
    const entryDate = new Date(`${item.entryDate}T00:00:00.000Z`);
    try {
      const outcome = await serializableTransaction(async (tx): Promise<ItemOutcome> => {
        const already = await tx.syncPushApplication.findUnique({ where: { localId: item.localId } });
        if (already) {
          return {
            kind: "applied",
            serverId: already.serverId,
            row: await fetchAppliedRow(tx, item.tableName, already.serverId),
            replay: true,
          };
        }

        if (item.tableName === "daily_online_stock") {
          const existing = await dailyOnlineStockRepository.findByProductAndDate(item.productId, entryDate, item.shift, tx);
          const input: Record<string, number> = {};
          for (const field of ONLINE_ADDITIVE_FIELDS) {
            const d = item.delta?.[field];
            if (d !== undefined) input[field] = toNum(existing?.[field as keyof typeof existing]) + d;
          }
          const saved = await saveOnlineEntry(item.productId, entryDate, item.shift, input, userId, tx);
          await tx.syncPushApplication.create({ data: { localId: item.localId, tableName: item.tableName, serverId: saved.id } });
          return { kind: "applied", serverId: saved.id, row: serializeOnline(saved), replay: false };
        }

        if (item.tableName === "daily_offline_stock") {
          const existing = await dailyOfflineStockRepository.findByProductAndDate(item.productId, entryDate, item.shift, tx);
          const input: Record<string, number> = {};
          for (const field of OFFLINE_ADDITIVE_FIELDS) {
            const d = item.delta?.[field];
            if (d !== undefined) input[field] = toNum(existing?.[field as keyof typeof existing]) + d;
          }
          const saved = await saveOfflineEntry(item.productId, entryDate, item.shift, input, userId, tx);
          await tx.syncPushApplication.create({ data: { localId: item.localId, tableName: item.tableName, serverId: saved.id } });
          return { kind: "applied", serverId: saved.id, row: serializeOffline(saved), replay: false };
        }

        if (!item.location) throw HttpError.badRequest("manual_counts push item missing location");
        if (item.manualCount === undefined) throw HttpError.badRequest("manual_counts push item missing manualCount");
        const existing = await manualCountRepository.findOne(item.productId, entryDate, item.shift, item.location, tx);
        const unseenServerChange = existing && existing.updatedAt.toISOString() !== item.baselineUpdatedAt;
        const valuesDiffer = existing && toNum(existing.manualCount) !== item.manualCount;
        if (unseenServerChange && valuesDiffer) {
          return {
            kind: "conflict",
            reason: "Manual count changed on the server since this device last saw it",
            mine: item.manualCount,
            server: serializeManualCount(existing!),
          };
        }
        const product = await productRepository.findActiveById(item.productId, tx);
        if (!product) throw HttpError.notFound("Active product not found");
        const saved = await saveManualCount(item.productId, entryDate, item.shift, item.location, item.manualCount, userId, undefined, tx);
        await tx.syncPushApplication.create({ data: { localId: item.localId, tableName: item.tableName, serverId: saved.id } });
        return { kind: "applied", serverId: saved.id, row: serializeManualCount(saved), replay: false };
      });

      if (outcome.kind === "applied") {
        applied.push({ localId: item.localId, serverId: outcome.serverId, row: outcome.row });
        // Only for a genuinely new application - not broadcast by
        // saveOnlineEntry/saveOfflineEntry/saveManualCount themselves since
        // they were passed `tx` (composed into this transaction, which
        // hadn't committed yet when they ran) - see their own doc comments.
        // An idempotent replay (the `already` branch above) changed nothing,
        // so there's nothing to tell other clients about.
        if (!outcome.replay) broadcastRealtimeEvent();
      } else {
        conflicts.push({ localId: item.localId, reason: outcome.reason, mine: outcome.mine, server: outcome.server });
      }
    } catch (err) {
      if (err instanceof HttpError) {
        // Most commonly the negative-stock guard - summing this client's
        // delta onto the server's current value would take a channel below
        // zero. Surfaced as a conflict for a human to review rather than
        // silently clamped or allowed through.
        conflicts.push({ localId: item.localId, reason: err.message, mine: item.delta ?? item.manualCount, server: null });
        continue;
      }
      throw err;
    }
  }

  return { applied, conflicts };
}
