import { ChangeAction, Prisma, Shift } from "@prisma/client";
import { prisma, type Db } from "../lib/prisma";

export interface ChangeLogCreateData {
  tableName: string;
  recordId: number;
  action: ChangeAction;
  changedById?: number | null;
  oldValue?: unknown;
  newValue?: unknown;
  importBatchId?: number | null;
  causedById?: number | null;
}

export interface ChangeLogFilters {
  tableName?: string;
  recordId?: number;
  dateFrom?: Date;
  dateTo?: Date;
  userId?: number;
  action?: ChangeAction;
  productId?: number;
  shift?: Shift;
  /// Only rows a CSV import wrote (importBatchId set).
  importOnly?: boolean;
  /// Generated-report rows only: "Daily Report" / "Variance Report" / "Audit Report".
  reportType?: string;
  /// ...and which section: "online" / "offline" / "all".
  reportSection?: string;
}

/// Generated-report rows (written by reportHistory.service).
export const REPORTS_TABLE = "reports";

/// Tables whose snapshots carry a productId; for "products" the record IS the product.
const STOCK_TABLES = ["daily_online_stock", "daily_offline_stock", "manual_counts"];

/// A snapshot field can sit in either snapshot: DELETE rows have no newValue.
function snapshotField(path: string, value: string | number): Prisma.ChangeLogWhereInput {
  return {
    OR: [
      { newValue: { path, equals: value } },
      { oldValue: { path, equals: value } },
    ],
  };
}

export function buildChangeLogWhere(f: ChangeLogFilters): Prisma.ChangeLogWhereInput {
  const and: Prisma.ChangeLogWhereInput[] = [];
  if (f.tableName) and.push({ tableName: f.tableName });
  if (f.recordId) and.push({ recordId: f.recordId });
  if (f.dateFrom || f.dateTo) and.push({ changedAt: { gte: f.dateFrom, lte: f.dateTo } });
  if (f.userId) and.push({ changedById: f.userId });
  if (f.action) and.push({ action: f.action });
  if (f.importOnly) and.push({ importBatchId: { not: null } });
  if (f.productId) {
    and.push({
      OR: [
        { tableName: "products", recordId: f.productId },
        { AND: [{ tableName: { in: STOCK_TABLES } }, snapshotField("$.productId", f.productId)] },
      ],
    });
  }
  if (f.shift) and.push(snapshotField("$.shift", f.shift));
  // Report rows only have a newValue (a CREATE), so no old/new split here.
  if (f.reportType || f.reportSection) {
    and.push({ tableName: REPORTS_TABLE });
    if (f.reportType) and.push({ newValue: { path: "$.type", equals: f.reportType } });
    if (f.reportSection) and.push({ newValue: { path: "$.section", equals: f.reportSection } });
  }
  return and.length ? { AND: and } : {};
}

export interface ChangeLogPageOptions {
  limit: number;
  /// Return rows older than this id (the previous page's nextCursor).
  cursor?: number;
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
        causedById: data.causedById ?? null,
      },
    });
  },

  /// One page of the filtered log, newest first. Ordered by id (append-only,
  /// so id order is time order) so the cursor is stable while new rows arrive.
  /// Fetches one extra row so the caller can tell whether another page exists.
  findPage(filters: ChangeLogFilters, { limit, cursor }: ChangeLogPageOptions) {
    const where = buildChangeLogWhere(filters);
    return prisma.changeLog.findMany({
      where: cursor ? { AND: [where, { id: { lt: cursor } }] } : where,
      include: { changedBy: { select: { id: true, name: true, username: true, role: true } } },
      orderBy: { id: "desc" },
      take: limit + 1,
    });
  },

  /// Live records the change rows point at, for labelling. Batched per table.
  findStockRecordsByIds(tableName: string, ids: number[]) {
    const select = { id: true, productId: true, entryDate: true, shift: true } as const;
    if (tableName === "daily_online_stock") return prisma.dailyOnlineStock.findMany({ where: { id: { in: ids } }, select });
    if (tableName === "daily_offline_stock") return prisma.dailyOfflineStock.findMany({ where: { id: { in: ids } }, select });
    return prisma.manualCount.findMany({ where: { id: { in: ids } }, select: { ...select, location: true } });
  },

  findProductsByIds(ids: number[]) {
    return prisma.product.findMany({ where: { id: { in: ids } }, select: { id: true, sku: true, name: true } });
  },

  /// Newest-first history for one record, for the per-cell history endpoint.
  /// Bounded well above the endpoint's own max limit (50): the service has to
  /// diff snapshots to find the ones that touched the requested field, so it
  /// needs more rows than it will return - but not the whole audit trail of a
  /// heavily-edited sheet. Served by the (tableName, recordId, id) index.
  findForRecord(tableName: string, recordId: number, take = 300) {
    return prisma.changeLog.findMany({
      where: { tableName, recordId },
      include: { changedBy: { select: { name: true } } },
      orderBy: { id: "desc" },
      take,
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
