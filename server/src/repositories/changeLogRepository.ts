import { ChangeAction } from "@prisma/client";
import { prisma, type Db } from "../lib/prisma";

export interface ChangeLogCreateData {
  tableName: string;
  recordId: number;
  action: ChangeAction;
  changedById?: number | null;
  oldValue?: unknown;
  newValue?: unknown;
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
};
