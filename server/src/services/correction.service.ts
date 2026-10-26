import { CorrectionStatus, Prisma, Shift, StockLocation } from "@prisma/client";
import { prisma } from "../lib/prisma";
import { HttpError } from "../utils/HttpError";
import { toNum } from "../utils/stockMath";
import { recordChange } from "./changeLog.service";
import { runAsAdjustment } from "./dayLock.service";
import { saveOnlineEntry } from "./dailyOnlineStock.service";
import { saveOfflineEntry } from "./dailyOfflineStock.service";
import { propagateOpeningStock, saveManualCount } from "./manualCounts.service";
import { STALE_OPENING_FIELD } from "./staleOpening.service";
import { refreshFrozenSnapshots } from "./snapshotRefresh.service";
import { broadcastRealtimeEvent } from "../lib/realtime";
import { previousPeriod } from "../utils/shift";
import { toDateOnlyString } from "../utils/date";

const CORRECTIONS_TABLE = "correction_requests";

/// Which figures a correction may name. Derived columns (remaining stock,
/// variance, ...) are deliberately absent: they follow from these.
const CORRECTABLE_FIELDS: Record<string, readonly string[]> = {
  daily_online_stock: ["stockInOffToOl", "stockOutOlToOff", "productionIn", "fulfillmentOut", "rts"],
  daily_offline_stock: ["stockInOlToOff", "stockOutOffToOl", "productionIn", "delivery1", "delivery2", "delivery3", "delivery4", "delivery5", "backloads", "upsellOut"],
  manual_counts: ["manualCount"],
};

export interface CorrectionInput {
  tableName: string;
  recordId: number;
  field: string;
  proposedValue: number;
  reason: string;
}

interface RecordSnapshot {
  productId: number;
  entryDate: Date;
  shift: Shift;
  location?: StockLocation;
  value: number;
}

async function loadRecord(tableName: string, recordId: number, field: string): Promise<RecordSnapshot> {
  const missing = () => HttpError.notFound("That record no longer exists.");
  if (tableName === "daily_online_stock") {
    const r = await prisma.dailyOnlineStock.findUnique({ where: { id: recordId } });
    if (!r) throw missing();
    return { productId: r.productId, entryDate: r.entryDate, shift: r.shift, value: toNum((r as Record<string, unknown>)[field] as never) };
  }
  if (tableName === "daily_offline_stock") {
    const r = await prisma.dailyOfflineStock.findUnique({ where: { id: recordId } });
    if (!r) throw missing();
    return { productId: r.productId, entryDate: r.entryDate, shift: r.shift, value: toNum((r as Record<string, unknown>)[field] as never) };
  }
  const r = await prisma.manualCount.findUnique({ where: { id: recordId } });
  if (!r) throw missing();
  return { productId: r.productId, entryDate: r.entryDate, shift: r.shift, location: r.location, value: toNum(r.manualCount) };
}

export async function requestCorrection(input: CorrectionInput, userId?: number) {
  const allowed = CORRECTABLE_FIELDS[input.tableName];
  if (!allowed || !allowed.includes(input.field)) throw HttpError.badRequest("That figure can't be corrected this way.");
  const snap = await loadRecord(input.tableName, input.recordId, input.field);
  if (snap.value === input.proposedValue) throw HttpError.badRequest("The proposed value is the same as the current one.");
  const pending = await prisma.correctionRequest.findFirst({
    where: { tableName: input.tableName, recordId: input.recordId, field: input.field, status: CorrectionStatus.PENDING },
    select: { id: true },
  });
  if (pending) throw HttpError.conflict("There is already a pending correction for that figure.");

  return prisma.$transaction(async (tx) => {
    const created = await tx.correctionRequest.create({
      data: {
        tableName: input.tableName,
        recordId: input.recordId,
        field: input.field,
        beforeValue: String(snap.value),
        proposedValue: String(input.proposedValue),
        reason: input.reason,
        requestedById: userId ?? null,
        events: { create: { event: "REQUESTED", byId: userId ?? null, note: input.reason } },
      },
    });
    await recordChange(
      { tableName: CORRECTIONS_TABLE, recordId: created.id, action: "CREATE", changedById: userId, newValue: created },
      tx,
    );
    return created;
  });
}

async function loadPending(id: number) {
  const req = await prisma.correctionRequest.findUnique({ where: { id } });
  if (!req) throw HttpError.notFound("Correction request not found.");
  if (req.status !== CorrectionStatus.PENDING) throw HttpError.conflict(`That request was already ${req.status.toLowerCase()}.`);
  return req;
}

/// Re-derives one finished row's opening stock from what actually carries into
/// it (a stale-opening request - see staleOpening.service.ts). The figure is
/// computed now, not replayed from the request, and written by the same
/// carry-forward walk as any other, so it is never pinned as a typed opening.
async function applyStaleOpening(tableName: string, recordId: number, snap: RecordSnapshot, userId?: number) {
  const location = tableName === "daily_online_stock" ? "ONLINE" : "OFFLINE";
  await prisma.$transaction(
    (tx) =>
      propagateOpeningStock(snap.productId, snap.entryDate, snap.shift, location, userId, tx, undefined, {
        from: previousPeriod(snap.entryDate, snap.shift),
        approvedRowId: recordId,
      }),
    { timeout: 60_000 },
  );
  broadcastRealtimeEvent();
}

/// Applies the figure through the normal save service - same validation, same
/// before/after change-log row, same carry-forward - but flagged as an
/// adjustment so a closed day accepts it. The request itself keeps who asked,
/// who approved, the value before and the value written.
///
/// The approval covers that one figure. Later finished days whose opening
/// stock would move are held for their own approval, unless `cascade` says the
/// approver accepts those consequences too (the Corrections screen shows them
/// first). Either way the frozen Daily Report of every day written to is
/// re-saved, so a finished day never keeps reporting figures its ledger no
/// longer has.
export async function approveCorrection(id: number, note: string | undefined, userId?: number, opts: { cascade?: boolean } = {}) {
  const req = await loadPending(id);
  const snap = await loadRecord(req.tableName, req.recordId, req.field);
  const value = Number(req.proposedValue);

  await runAsAdjustment(
    async () => {
      if (req.field === STALE_OPENING_FIELD) {
        await applyStaleOpening(req.tableName, req.recordId, snap, userId);
      } else if (req.tableName === "daily_online_stock") {
        await saveOnlineEntry(snap.productId, snap.entryDate, snap.shift, { [req.field]: value }, userId);
      } else if (req.tableName === "daily_offline_stock") {
        await saveOfflineEntry(snap.productId, snap.entryDate, snap.shift, { [req.field]: value }, userId);
      } else {
        await saveManualCount(snap.productId, snap.entryDate, snap.shift, snap.location!, value, userId);
      }
    },
    { cascade: opts.cascade },
  );

  const refreshed = await refreshFrozenSnapshots(snap.entryDate, { cascade: opts.cascade, userId });

  return prisma.$transaction(async (tx) => {
    const updated = await tx.correctionRequest.update({
      where: { id },
      data: {
        status: CorrectionStatus.APPROVED,
        reviewedById: userId ?? null,
        reviewedAt: new Date(),
        reviewNote: note ?? null,
        appliedBefore: String(snap.value),
        events: { create: { event: "APPROVED", byId: userId ?? null, note: note ?? null } },
      },
    });
    await recordChange(
      { tableName: CORRECTIONS_TABLE, recordId: id, action: "UPDATE", changedById: userId, oldValue: req, newValue: updated },
      tx,
    );
    return { ...updated, snapshotsRefreshed: refreshed.map(toDateOnlyString) };
  });
}

export async function rejectCorrection(id: number, note: string, userId?: number) {
  const req = await loadPending(id);
  return prisma.$transaction(async (tx) => {
    const updated = await tx.correctionRequest.update({
      where: { id },
      data: {
        status: CorrectionStatus.REJECTED,
        reviewedById: userId ?? null,
        reviewedAt: new Date(),
        reviewNote: note,
        events: { create: { event: "REJECTED", byId: userId ?? null, note } },
      },
    });
    await recordChange(
      { tableName: CORRECTIONS_TABLE, recordId: id, action: "UPDATE", changedById: userId, oldValue: req, newValue: updated },
      tx,
    );
    return updated;
  });
}

const personSelect = { select: { id: true, name: true, username: true } } as const;

export async function listCorrections(opts: { status?: CorrectionStatus; limit: number; offset: number; requestedById?: number }) {
  const where: Prisma.CorrectionRequestWhereInput = {
    ...(opts.status ? { status: opts.status } : {}),
    ...(opts.requestedById ? { requestedById: opts.requestedById } : {}),
  };
  const [items, total] = await Promise.all([
    prisma.correctionRequest.findMany({
      where,
      include: { requestedBy: personSelect, reviewedBy: personSelect, events: { include: { by: personSelect }, orderBy: { id: "asc" } } },
      orderBy: { id: "desc" },
      skip: opts.offset,
      take: opts.limit,
    }),
    prisma.correctionRequest.count({ where }),
  ]);
  return { items, total };
}

export function countPendingCorrections() {
  return prisma.correctionRequest.count({ where: { status: CorrectionStatus.PENDING } });
}
