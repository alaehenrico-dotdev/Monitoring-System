import { Prisma, ReleaseStatus, Shift, StockLocation } from "@prisma/client";
import { prisma, serializableTransaction } from "../lib/prisma";
import { HttpError } from "../utils/HttpError";
import { toDateOnlyString } from "../utils/date";
import { toNum } from "../utils/stockMath";
import { MAX_EXTRAS_PER_COLUMN } from "../utils/stockExtras";
import { broadcastRealtimeEvent } from "../lib/realtime";
import { dailyOnlineStockRepository } from "../repositories/dailyOnlineStockRepository";
import { dailyOfflineStockRepository } from "../repositories/dailyOfflineStockRepository";
import { dailyStockExtraRepository } from "../repositories/dailyStockExtraRepository";
import { productRepository } from "../repositories/productRepository";
import { recordChange } from "./changeLog.service";
import { saveOnlineEntry } from "./dailyOnlineStock.service";
import { saveOfflineEntry } from "./dailyOfflineStock.service";

/**
 * Finished goods that exist but cannot be sold yet (no label, no sticker, ...)
 * are not stock. They are kept out of the day's entries and counts instead of
 * being forced into a day that is finishing, and recorded here so they cannot
 * be forgotten.
 *
 * Releasing one adds its quantity to Production (In) on the shift it actually
 * became sellable - the CURRENT shift, never an earlier one. That is the whole
 * point: nothing finished is back-dated, so no carry-forward ripples into a
 * locked day and no reported figure moves.
 */

const PENDING_RELEASES_TABLE = "pending_releases";

/// A release goes into the current shift: within a day of today. The finished-day
/// lock already stops an older day; this stops an old day that was merely left
/// unfinished from quietly receiving back-dated production.
const RELEASE_WINDOW_DAYS = 1;
const DAY_MS = 86_400_000;
const MAX_QUANTITY = 99_999_999;

const round2 = (n: number) => Math.round(n * 100) / 100;

export type EntryLoc = "ONLINE" | "OFFLINE";

export interface CreatePendingInput {
  location: EntryLoc;
  productId: number;
  quantity: number;
  madeDate: Date;
  madeShift: Shift;
  reason: string;
}

export async function createPendingRelease(input: CreatePendingInput, userId?: number, now: Date = new Date()) {
  if (!(input.quantity > 0) || input.quantity > MAX_QUANTITY) throw HttpError.badRequest("Quantity must be more than 0.");
  if (round2(input.quantity) !== input.quantity) throw HttpError.badRequest("Quantity can have at most 2 decimals.");
  if (toDateOnlyString(input.madeDate) > toDateOnlyString(new Date(now.getTime() + DAY_MS))) {
    throw HttpError.badRequest("The made date can't be in the future.");
  }
  const product = await productRepository.findActiveById(input.productId);
  if (!product) throw HttpError.notFound("Active product not found");

  return prisma.$transaction(async (tx) => {
    const created = await tx.pendingRelease.create({
      data: {
        location: input.location as StockLocation,
        productId: input.productId,
        quantity: input.quantity,
        madeDate: input.madeDate,
        madeShift: input.madeShift,
        reason: input.reason,
        createdById: userId ?? null,
      },
      include: { product: { select: { id: true, name: true, sku: true, unit: true } } },
    });
    await recordChange({ tableName: PENDING_RELEASES_TABLE, recordId: created.id, action: "CREATE", changedById: userId, newValue: created }, tx);
    return created;
  });
}

async function loadAwaiting(tx: Prisma.TransactionClient, id: number) {
  const item = await tx.pendingRelease.findUnique({ where: { id } });
  if (!item) throw HttpError.notFound("That item no longer exists.");
  if (item.status !== ReleaseStatus.AWAITING) throw HttpError.conflict(`That item was already ${item.status.toLowerCase()}.`);
  return item;
}

export async function updatePendingRelease(
  id: number,
  patch: { quantity?: number; reason?: string },
  userId?: number,
) {
  if (patch.quantity !== undefined && (!(patch.quantity > 0) || patch.quantity > MAX_QUANTITY || round2(patch.quantity) !== patch.quantity)) {
    throw HttpError.badRequest("Quantity must be more than 0, with at most 2 decimals.");
  }
  return prisma.$transaction(async (tx) => {
    const item = await loadAwaiting(tx, id);
    const updated = await tx.pendingRelease.update({ where: { id }, data: { quantity: patch.quantity, reason: patch.reason } });
    await recordChange({ tableName: PENDING_RELEASES_TABLE, recordId: id, action: "UPDATE", changedById: userId, oldValue: item, newValue: updated }, tx);
    return updated;
  });
}

/// Writes the item off (never completed, damaged, merged elsewhere). The reason
/// is required: an item must never just disappear from the list.
export async function cancelPendingRelease(id: number, note: string, userId?: number) {
  return prisma.$transaction(async (tx) => {
    const item = await loadAwaiting(tx, id);
    const updated = await tx.pendingRelease.update({
      where: { id },
      data: { status: ReleaseStatus.CANCELLED, resolutionNote: note, releasedAt: new Date(), releasedById: userId ?? null },
    });
    await recordChange({ tableName: PENDING_RELEASES_TABLE, recordId: id, action: "UPDATE", changedById: userId, oldValue: item, newValue: updated }, tx);
    return updated;
  });
}

/**
 * Releases an item into Production (In) of `target` (the current shift). One
 * transaction does both halves - the entry save and the status change - so an
 * item can neither be released twice nor marked released without its stock.
 *
 * The save goes through the normal entry service, so every rule it has applies:
 * a finished period refuses it, days are finished in order, and the change is
 * logged and carried forward like any other. If the cell already holds
 * individually-entered amounts ("+1" columns) the quantity is added as one more
 * of them, so the total and the amounts behind it still agree.
 */
export async function releasePendingRelease(
  id: number,
  target: { entryDate: Date; shift: Shift },
  note: string | undefined,
  userId?: number,
  now: Date = new Date(),
) {
  const today = toDateOnlyString(now);
  const day = toDateOnlyString(target.entryDate);
  const dayDiff = Math.round((Date.parse(`${day}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / DAY_MS);
  if (Math.abs(dayDiff) > RELEASE_WINDOW_DAYS) {
    throw HttpError.badRequest(`Release into the current shift (within a day of ${today}). Back-dating stock into ${day} would change a day that was already reported.`);
  }

  const result = await serializableTransaction(async (tx) => {
    const item = await loadAwaiting(tx, id);
    if (day < toDateOnlyString(item.madeDate)) {
      throw HttpError.badRequest(`These were made on ${toDateOnlyString(item.madeDate)}; they can't be released before that.`);
    }
    const location = item.location as EntryLoc;
    const quantity = toNum(item.quantity);

    const repo = location === "ONLINE" ? dailyOnlineStockRepository : dailyOfflineStockRepository;
    const existing = await repo.findByProductAndDate(item.productId, target.entryDate, target.shift, tx);
    const extras = (await dailyStockExtraRepository.findForProduct(location, item.productId, target.entryDate, target.shift, tx)).filter(
      (e) => e.columnKey === "productionIn",
    );

    let input: { productionIn?: number; extras?: { columnKey: string; slotIndex: number; amount: number }[] };
    if (extras.length > 0) {
      if (extras.length >= MAX_EXTRAS_PER_COLUMN) {
        throw HttpError.badRequest(`Production (In) already has ${MAX_EXTRAS_PER_COLUMN} added columns for this product and shift; combine some first.`);
      }
      const nextSlot = Math.max(...extras.map((e) => e.slotIndex)) + 1;
      input = {
        extras: [
          ...extras.map((e) => ({ columnKey: "productionIn", slotIndex: e.slotIndex, amount: toNum(e.amount) })),
          { columnKey: "productionIn", slotIndex: nextSlot, amount: quantity },
        ],
      };
    } else {
      input = { productionIn: round2(toNum(existing?.productionIn) + quantity) };
    }

    if (location === "ONLINE") await saveOnlineEntry(item.productId, target.entryDate, target.shift, input, userId, tx);
    else await saveOfflineEntry(item.productId, target.entryDate, target.shift, input, userId, tx);

    const updated = await tx.pendingRelease.update({
      where: { id },
      data: {
        status: ReleaseStatus.RELEASED,
        releasedAt: new Date(),
        releasedById: userId ?? null,
        releasedEntryDate: target.entryDate,
        releasedShift: target.shift,
        resolutionNote: note ?? null,
      },
    });
    await recordChange({ tableName: PENDING_RELEASES_TABLE, recordId: id, action: "UPDATE", changedById: userId, oldValue: item, newValue: updated }, tx);
    return updated;
  });
  broadcastRealtimeEvent();
  return result;
}

export interface ListPendingOptions {
  status?: ReleaseStatus;
  location?: EntryLoc;
  productId?: number;
  limit: number;
  offset: number;
}

export async function listPendingReleases(opts: ListPendingOptions, now: Date = new Date()) {
  const where: Prisma.PendingReleaseWhereInput = {
    ...(opts.status ? { status: opts.status } : {}),
    ...(opts.location ? { location: opts.location } : {}),
    ...(opts.productId ? { productId: opts.productId } : {}),
  };
  const [items, total] = await Promise.all([
    prisma.pendingRelease.findMany({
      where,
      include: {
        product: { select: { id: true, name: true, sku: true, unit: true, category: true } },
        createdBy: { select: { id: true, name: true } },
        releasedBy: { select: { id: true, name: true } },
      },
      // Oldest first: the item waiting longest is the one to chase.
      orderBy: opts.status === ReleaseStatus.AWAITING || !opts.status ? [{ status: "asc" }, { madeDate: "asc" }, { id: "asc" }] : [{ id: "desc" }],
      skip: opts.offset,
      take: opts.limit,
    }),
    prisma.pendingRelease.count({ where }),
  ]);
  const today = Date.parse(`${toDateOnlyString(now)}T00:00:00Z`);
  return {
    total,
    items: items.map((i) => ({ ...i, ageDays: Math.max(0, Math.round((today - i.madeDate.getTime()) / DAY_MS)) })),
  };
}

/// What the page header and dashboards show: how many are waiting and how long
/// the oldest has been.
export async function awaitingSummary(now: Date = new Date()) {
  const [count, oldest] = await Promise.all([
    prisma.pendingRelease.count({ where: { status: ReleaseStatus.AWAITING } }),
    prisma.pendingRelease.findFirst({ where: { status: ReleaseStatus.AWAITING }, orderBy: { madeDate: "asc" }, select: { madeDate: true } }),
  ]);
  const today = Date.parse(`${toDateOnlyString(now)}T00:00:00Z`);
  return { awaiting: count, oldestAgeDays: oldest ? Math.max(0, Math.round((today - oldest.madeDate.getTime()) / DAY_MS)) : 0 };
}
