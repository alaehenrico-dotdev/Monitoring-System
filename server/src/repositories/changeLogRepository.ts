import { ChangeAction } from "@prisma/client";
import { prisma, type Db } from "../lib/prisma";

export interface ChangeLogCreateData {
  tableName: string;
  recordId: number;
  action: ChangeAction;
  changedById?: number | null;
  oldValue?: unknown;
  newValue?: unknown;
  importBatchId?: number | null;
}

export interface ChangeLogFilters {
  tableName?: string;
  recordId?: number;
}

/// Section 5.8 - change_log: accountability and variance tracing.
export const changeLogRepository = {
  create(data: ChangeLogCreateData, db: Db = prisma) {
    return db.changeLog.create({
      data: {
        tableName: data.tableName,
        recordId: data.recordId,
        action: data.action,
        changedById: data.changedById ?? null,
        oldValue: data.oldValue === undefined ? undefined : JSON.parse(JSON.stringify(data.oldValue)),
        newValue: data.newValue === undefined ? undefined : JSON.parse(JSON.stringify(data.newValue)),
        importBatchId: data.importBatchId ?? null,
      },
    });
  },

  findMany(filters: ChangeLogFilters) {
    return prisma.changeLog.findMany({
      where: { tableName: filters.tableName, recordId: filters.recordId },
      include: { changedBy: { select: { id: true, name: true, username: true, role: true } } },
      orderBy: { changedAt: "desc" },
      take: 500,
    });
  },

  /// Every write a given import batch produced, in the order they were made -
  /// see importBatch.service.ts's revertImportBatch, which reverts each one.
  findByImportBatch(importBatchId: number, db: Db = prisma) {
    return db.changeLog.findMany({
      where: { importBatchId },
      orderBy: { id: "asc" },
    });
  },

  /// The single most recent change_log row for one record, regardless of
  /// which batch (if any) wrote it - revertImportBatch's "has this cell been
  /// touched since the import?" check: a record is still safe to revert only
  /// when its own import-tagged row is still this.
  findLatestForRecord(tableName: string, recordId: number, db: Db = prisma) {
    return db.changeLog.findFirst({
      where: { tableName, recordId },
      orderBy: { id: "desc" },
    });
  },
};
