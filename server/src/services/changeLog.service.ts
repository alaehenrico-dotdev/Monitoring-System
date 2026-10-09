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
    importBatchId?: number | null;
  },
  db: Db = prisma,
) {
  await changeLogRepository.create(params, db);
}

export async function listChangeLog(filters: { tableName?: string; recordId?: number }) {
  return changeLogRepository.findMany(filters);
}

/**
 * Tables a non-admin may read cell history from.
 *
 * An allowlist rather than a free-text table name: the endpoint below is open
 * to encoders, and change_log is one undifferentiated audit table covering
 * users, products and imports as well as the stock grids. Without this, "read
 * the history of a cell" would be "read any audit row in the system".
 */
const CELL_HISTORY_TABLES = new Set([
  "daily_online_stock",
  "daily_offline_stock",
  "manual_counts",
]);

export function isCellHistoryTable(tableName: string): boolean {
  return CELL_HISTORY_TABLES.has(tableName);
}

export interface CellHistoryEntry {
  changedAt: Date;
  who: string | null;
  /// Null on a CREATE - there was no previous row to have held a value.
  oldValue: number | null;
  newValue: number;
}

function numberOrNull(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

/**
 * The last `limit` edits to ONE field of one record, newest first.
 *
 * change_log stores whole-row JSON snapshots keyed by (tableName, recordId),
 * not one row per field, so "history for this cell" has to be derived by
 * diffing consecutive snapshots - there is no column to filter on in SQL.
 * The diffing is done here rather than in the client for two reasons: it
 * keeps the response to the handful of entries that actually touched this
 * field, and - since this endpoint is open to encoders - it means the
 * response carries only the one field they asked about instead of a full
 * row snapshot of every other figure on the sheet.
 *
 * A CREATE counts as setting every non-zero field: first entry of a figure
 * is a real event, while the dozens of columns left at their 0 default are
 * not.
 */
export async function getCellHistory(params: {
  tableName: string;
  recordId: number;
  field: string;
  limit: number;
}): Promise<CellHistoryEntry[]> {
  const entries = await changeLogRepository.findForRecord(params.tableName, params.recordId);

  const out: CellHistoryEntry[] = [];
  for (const e of entries) {
    const next = numberOrNull((e.newValue as Record<string, unknown> | null)?.[params.field]);
    if (next === null) continue;

    if (e.action === "CREATE") {
      if (next === 0) continue;
      out.push({ changedAt: e.changedAt, who: e.changedBy?.name ?? null, oldValue: null, newValue: next });
    } else {
      const prev = numberOrNull((e.oldValue as Record<string, unknown> | null)?.[params.field]);
      if (prev === null || prev === next) continue;
      out.push({ changedAt: e.changedAt, who: e.changedBy?.name ?? null, oldValue: prev, newValue: next });
    }
    if (out.length >= params.limit) break;
  }
  return out;
}
