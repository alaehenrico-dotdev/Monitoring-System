import { prisma, type Db } from "../lib/prisma";
import { REPORTS_TABLE } from "../repositories/changeLogRepository";
import { reportHistoryRepository } from "../repositories/reportHistoryRepository";
import { recordChange } from "./changeLog.service";


type ReportHistoryInput = { type: string; scope: string; route: string; section?: string };

/// The entry plus its change-log row, inside the caller's transaction - for a
/// report the server itself generates (Finish day), so the saved report and
/// its history entry cannot exist without each other.
export async function recordReportHistoryIn(tx: Db, data: ReportHistoryInput, userId?: number) {
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
}

export function recordReportHistory(data: ReportHistoryInput, userId?: number) {
  // Also written to the change log so a generated report shows up there, in
  // the same transaction so neither can exist without the other.
  return prisma.$transaction((tx) => recordReportHistoryIn(tx, data, userId));
}

const REPORT_HISTORY_PAGE = 50;

export async function listReportHistory(type?: string, cursor?: number, limit = REPORT_HISTORY_PAGE) {
  const rows = await reportHistoryRepository.findPage({ type }, { limit, cursor });
  const hasMore = rows.length > limit;
  const items = hasMore ? rows.slice(0, limit) : rows;
  return { items, nextCursor: hasMore ? items[items.length - 1].id : null };
}
