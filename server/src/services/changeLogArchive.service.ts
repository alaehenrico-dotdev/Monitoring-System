import { prisma } from "../lib/prisma";
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

export async function runArchive(months: number, userId?: number | null): Promise<{ moved: number; cutoff: Date }> {
  const cutoff = archiveCutoff(months);
  const moved = await archiveChangeLog(cutoff);
  if (moved > 0) await logSystemEvent("change_log_archive", { moved, cutoff: cutoff.toISOString() }, userId ?? null);
  return { moved, cutoff };
}

export async function listArchive(opts: { limit: number; offset?: number; tableName?: string; recordId?: number }) {
  const where = {
    ...(opts.tableName ? { tableName: opts.tableName } : {}),
    ...(opts.recordId ? { recordId: opts.recordId } : {}),
  };
  const [items, total] = await Promise.all([
    prisma.changeLogArchive.findMany({ where, orderBy: { id: "desc" }, skip: opts.offset ?? 0, take: opts.limit }),
    prisma.changeLogArchive.count({ where }),
  ]);
  return { items, total };
}

