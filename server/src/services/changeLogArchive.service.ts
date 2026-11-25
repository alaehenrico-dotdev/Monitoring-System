import { prisma } from "../lib/prisma";
import { CHANGE_LOG_COUNT_CAP, cappedCount } from "../repositories/changeLogRepository";
import { logSystemEvent } from "./changeLog.service";

const BATCH = 1000;
const MAX_BATCHES_PER_RUN = 200;

export function archiveCutoff(months: number, now = new Date()): Date {
  const d = new Date(now);
  d.setUTCMonth(d.getUTCMonth() - months);
  return d;
}

/// Moves change_log rows older than `cutoff` into change_log_archive, in small
/// batches, each batch copied and deleted in one transaction so a row is never
/// in neither table. Rows tied to a CSV import (importBatchId) stay put: undoing
/// an import reads them. Returns how many rows were moved.
export async function archiveChangeLog(cutoff: Date): Promise<number> {
  let moved = 0;
  for (let i = 0; i < MAX_BATCHES_PER_RUN; i++) {
    const rows = await prisma.changeLog.findMany({
      where: { changedAt: { lt: cutoff }, importBatchId: null },
      orderBy: { id: "asc" },
      take: BATCH,
    });
    if (rows.length === 0) break;
    await prisma.$transaction(async (tx) => {
      await tx.changeLogArchive.createMany({
        data: rows.map((r) => ({
          id: r.id,
          tableName: r.tableName,
          recordId: r.recordId,
          action: r.action,
          changedById: r.changedById,
          changedAt: r.changedAt,
          oldValue: r.oldValue ?? undefined,
          newValue: r.newValue ?? undefined,
          importBatchId: r.importBatchId,
          causedById: r.causedById,
        })),
        skipDuplicates: true,
      });
      await tx.changeLog.deleteMany({ where: { id: { in: rows.map((r) => r.id) } } });
    });
    moved += rows.length;
    if (rows.length < BATCH) break;
  }
  return moved;
}

/// "system" rows that are only ever noise once they are old: refusals and failures, many of them written by
/// anonymous requests. Deliberately NOT here: "login" (the Users list reads each person's last sign-in from
/// it), successful security changes (password, two-step, recovery email), backups and restores, drive and
/// settings changes - that is the audit trail, and it stays until the normal archive moves it.
export const NOISY_SYSTEM_EVENTS = [
  "login_failed",
  "mfa_failed",
  "password_reset_failed",
  "password_reset_email_skipped",
  "password_reset_email_failed",
  "recovery_email_verify_refused",
  "recovery_email_send_failed",
] as const;

const PURGE_BATCH = 1000;
const PURGE_MAX_BATCHES = 50;
const DAY_MS = 24 * 60 * 60 * 1000;

/// Deletes noisy system rows (NOISY_SYSTEM_EVENTS) older than `olderThanDays`, in small batches so no single
/// delete holds locks for long, and at most PURGE_MAX_BATCHES a run (the next night continues). 0 = off.
/// Returns how many rows went.
export async function purgeNoisySystemEvents(olderThanDays: number, now = Date.now()): Promise<number> {
  if (olderThanDays <= 0) return 0;
  const cutoff = new Date(now - olderThanDays * DAY_MS);
  let removed = 0;
  let backlog = false;
  for (let i = 0; i < PURGE_MAX_BATCHES; i++) {
    const rows = await prisma.changeLog.findMany({
      where: {
        tableName: "system",
        changedAt: { lt: cutoff },
        OR: NOISY_SYSTEM_EVENTS.map((event) => ({ newValue: { path: "$.event", equals: event } })),
      },
      orderBy: { id: "asc" },
      select: { id: true },
      take: PURGE_BATCH,
    });
    if (rows.length === 0) break;
    const { count } = await prisma.changeLog.deleteMany({ where: { id: { in: rows.map((r) => r.id) } } });
    removed += count;
    if (rows.length < PURGE_BATCH) break;
    // A full last batch means the run stopped at its limit, not because the work was done.
    backlog = i === PURGE_MAX_BATCHES - 1;
  }
  if (removed > 0) {
    await logSystemEvent("system_events_purged", {
      removed,
      olderThanDays,
      before: cutoff.toISOString(),
      events: NOISY_SYSTEM_EVENTS,
      ...(backlog ? { moreToDelete: true } : {}),
    });
  }
  return removed;
}

export async function runArchive(months: number, userId?: number | null): Promise<{ moved: number; cutoff: Date }> {
  const cutoff = archiveCutoff(months);
  const moved = await archiveChangeLog(cutoff);
  if (moved > 0) await logSystemEvent("change_log_archive", { moved, cutoff: cutoff.toISOString() }, userId ?? null);
  return { moved, cutoff };
}

export interface ArchiveFilters {
  tableName?: string;
  recordId?: number;
  dateFrom?: Date;
  dateTo?: Date;
  userId?: number;
  action?: "CREATE" | "UPDATE" | "DELETE";
}

/// One page of the archive, newest first. Same filters as the live Change Log (minus the ones that read
/// inside the JSON snapshots), and the total is counted only up to CHANGE_LOG_COUNT_CAP, like the live list.
export async function listArchive(opts: ArchiveFilters & { limit: number; offset?: number }) {
  const where = {
    ...(opts.tableName ? { tableName: opts.tableName } : {}),
    ...(opts.recordId ? { recordId: opts.recordId } : {}),
    ...(opts.dateFrom || opts.dateTo ? { changedAt: { gte: opts.dateFrom, lte: opts.dateTo } } : {}),
    ...(opts.userId ? { changedById: opts.userId } : {}),
    ...(opts.action ? { action: opts.action } : {}),
  };
  const [items, counted] = await Promise.all([
    prisma.changeLogArchive.findMany({ where, orderBy: { id: "desc" }, skip: opts.offset ?? 0, take: opts.limit }),
    prisma.changeLogArchive.findMany({ where, select: { id: true }, orderBy: { id: "desc" }, take: CHANGE_LOG_COUNT_CAP + 1 }),
  ]);
  const { total, capped } = cappedCount(counted.length);
  return { items, total, ...(capped ? { totalCapped: true } : {}) };
}
