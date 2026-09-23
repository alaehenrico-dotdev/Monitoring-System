import { ChangeAction } from "@prisma/client";
import { prisma, type Db } from "../lib/prisma";
import { changeLogRepository } from "../repositories/changeLogRepository";

/**
 * Section 4.8 / 5.8 - every create/edit to a stock entry, manual count, or
 * receipt is timestamped and attributed to the encoder who made it, so a
 * disputed number can be traced back to its source instead of disappearing
 * into an overwritten cell (Section 2.1).
 */
export async function recordChange(
  params: {
    tableName: string;
    recordId: number;
    action: ChangeAction;
    changedById?: number | null;
    oldValue?: unknown;
    newValue?: unknown;
  },
  db: Db = prisma,
) {
  await changeLogRepository.create(params, db);
}

export async function listChangeLog(filters: { tableName?: string; recordId?: number }) {
  return changeLogRepository.findMany(filters);
}
