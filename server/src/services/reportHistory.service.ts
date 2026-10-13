import { prisma } from "../lib/prisma";
import { REPORTS_TABLE } from "../repositories/changeLogRepository";
import { reportHistoryRepository } from "../repositories/reportHistoryRepository";
import { recordChange } from "./changeLog.service";


export function recordReportHistory(
  data: { type: string; scope: string; route: string; section?: string },
  userId?: number,
) {
  // Also written to the change log so a generated report shows up there, in
  // the same transaction so neither can exist without the other.
  return prisma.$transaction(async (tx) => {
    const entry = await reportHistoryRepository.create({ ...data, generatedById: userId }, tx);
    await recordChange(
      {
        tableName: REPORTS_TABLE,
        recordId: entry.id,
        action: "CREATE",
        changedById: userId,
        newValue: { type: data.type, scope: data.scope, section: data.section ?? null, route: data.route },
      },
      tx,
    );
    return entry;
  });
}

export const REPORT_HISTORY_PAGE = 50;

export async function listReportHistory(type?: string, cursor?: number, limit = REPORT_HISTORY_PAGE) {
  const rows = await reportHistoryRepository.findPage({ type }, { limit, cursor });
  const hasMore = rows.length > limit;
  const items = hasMore ? rows.slice(0, limit) : rows;
  return { items, nextCursor: hasMore ? items[items.length - 1].id : null };
}
