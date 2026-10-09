import { ChangeAction } from "@prisma/client";
import { prisma, type Db } from "../lib/prisma";
import { changeLogRepository, REPORTS_TABLE, type ChangeLogFilters } from "../repositories/changeLogRepository";
import { toDateOnlyString } from "../utils/date";
import { diffChanges, summarizeChange } from "../utils/changeSummary";

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
    causedById?: number | null;
  },
  db: Db = prisma,
): Promise<number> {
  // The new row's id, so a change that triggers follow-on writes can be named
  // as their cause (causedById).
  return (await changeLogRepository.create(params, db)).id;
}

/// Records an administrative event that has no record of its own (a sign-in, a
/// backup download or restore) as a "system" row. Best effort by design: the
/// event it describes has already happened, and failing a login or a download
/// because its log line could not be written would be worse than the gap.
export async function logSystemEvent(
  event: string,
  details: Record<string, unknown>,
  userId?: number | null,
  action: "CREATE" | "UPDATE" | "DELETE" = "CREATE",
): Promise<void> {
  try {
    await recordChange({ tableName: "system", recordId: 0, action, changedById: userId ?? null, newValue: { event, ...details } });
  } catch (err) {
    console.error(`Could not log system event "${event}":`, err);
  }
}

export const DEFAULT_CHANGE_LOG_LIMIT = 100;
export const MAX_CHANGE_LOG_LIMIT = 500;
/// Hard stop for the CSV export so one request can't read the whole audit table.
const EXPORT_ROW_CAP = 50_000;
const EXPORT_CHUNK = MAX_CHANGE_LOG_LIMIT;

const SHIFT_LABELS: Record<string, string> = { MORNING: "Morning", NIGHT: "Night" };
const LOCATION_LABELS: Record<string, string> = { ONLINE: "Online", OFFLINE: "Offline", TOTAL: "Total" };

/// What a stock/manual-count/product change row points at, so nobody has to
/// look up "record #4821". Null for system events.
export interface ChangeLogContext {
  productId: number | null;
  sku: string | null;
  productName: string | null;
  /// YYYY-MM-DD
  entryDate: string | null;
  shift: "MORNING" | "NIGHT" | null;
  location: "ONLINE" | "OFFLINE" | "TOTAL" | null;
}

/// Bulk origins that are recorded today: a CSV import (importBatchId) and a
/// data reset (system row). Reverts are not distinguishable in change_log.
export type ChangeLogSource = "import" | "reset" | null;

type Row = Awaited<ReturnType<typeof changeLogRepository.findPage>>[number];

function asObject(v: unknown): Record<string, unknown> {
  return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
}

const SECTION_LABELS: Record<string, string> = { online: "Online", offline: "Offline", all: "Full" };

/// "Daily Report · Online · 2026-10-09". Entries from before the section was
/// recorded have none, so it is left out rather than guessed.
function describeReport(newValue: unknown): string {
  const v = asObject(newValue);
  const section = typeof v.section === "string" ? SECTION_LABELS[v.section] : undefined;
  return [v.type, section, v.scope].filter((p): p is string => typeof p === "string" && !!p).join(" · ");
}

function dateOnly(v: unknown): string | null {
  if (v instanceof Date) return toDateOnlyString(v);
  if (typeof v === "string" && /^\d{4}-\d{2}-\d{2}/.test(v)) return v.slice(0, 10);
  return null;
}

/// Adds the readable context to a page of rows. The live record is preferred;
/// when it (or its product) has been deleted, the row's own snapshot - which
/// holds the same productId/entryDate/shift/location - is what's returned.
async function enrich(rows: Row[]) {
  const idsByTable = new Map<string, number[]>();
  for (const r of rows) {
    if (!CELL_HISTORY_TABLES.has(r.tableName)) continue;
    const ids = idsByTable.get(r.tableName);
    if (ids) ids.push(r.recordId);
    else idsByTable.set(r.tableName, [r.recordId]);
  }
  const live = new Map<string, { productId: number; entryDate: Date; shift: string; location?: string }>();
  await Promise.all(
    [...idsByTable].map(async ([table, ids]) => {
      for (const rec of await changeLogRepository.findStockRecordsByIds(table, ids)) live.set(`${table}:${rec.id}`, rec);
    }),
  );

  const snapshotOf = (r: Row) => asObject(r.newValue ?? r.oldValue);
  const productIdOf = (r: Row): number | null => {
    const pid = live.get(`${r.tableName}:${r.recordId}`)?.productId ?? Number(snapshotOf(r).productId);
    return Number.isInteger(pid) ? pid : null;
  };

  const productIds = new Set<number>();
  for (const r of rows) {
    if (r.tableName === "products") productIds.add(r.recordId);
    else if (CELL_HISTORY_TABLES.has(r.tableName)) {
      const pid = productIdOf(r);
      if (pid !== null) productIds.add(pid);
    }
  }
  const products = new Map(
    productIds.size ? (await changeLogRepository.findProductsByIds([...productIds])).map((p) => [p.id, p] as const) : [],
  );

  return rows.map((r) => {
    const snap = snapshotOf(r);
    let context: ChangeLogContext | null = null;
    if (r.tableName === "products") {
      const p = products.get(r.recordId);
      context = {
        productId: r.recordId,
        sku: p ? p.sku : ((snap.sku as string | null | undefined) ?? null),
        productName: p ? p.name : ((snap.name as string | undefined) ?? null),
        entryDate: null,
        shift: null,
        location: null,
      };
    } else if (CELL_HISTORY_TABLES.has(r.tableName)) {
      const rec = live.get(`${r.tableName}:${r.recordId}`);
      const pid = productIdOf(r);
      const p = pid === null ? undefined : products.get(pid);
      context = {
        productId: pid,
        sku: p?.sku ?? null,
        // A deleted product leaves nothing on the row to name it by.
        productName: p?.name ?? null,
        entryDate: dateOnly(rec?.entryDate ?? snap.entryDate),
        shift: ((rec?.shift ?? snap.shift) as ChangeLogContext["shift"]) ?? null,
        location: (r.tableName === "daily_online_stock"
          ? "ONLINE"
          : r.tableName === "daily_offline_stock"
            ? "OFFLINE"
            : (rec?.location ?? snap.location ?? null)) as ChangeLogContext["location"],
      };
    }

    const isSystem = r.tableName === "system";
    const isReport = r.tableName === REPORTS_TABLE;
    const source: ChangeLogSource =
      r.importBatchId !== null ? "import" : isSystem && asObject(r.newValue).event === "data_reset" ? "reset" : null;

    return {
      ...r,
      context,
      source,
      summary: isSystem ? null : isReport ? describeReport(r.newValue) : summarizeChange(r.action, r.oldValue, r.newValue),
      changes: isSystem || isReport ? [] : diffChanges(r.oldValue, r.newValue),
    };
  });
}

export type ChangeLogItem = Awaited<ReturnType<typeof enrich>>[number];

/// One newest-first page of the filtered log. `nextCursor` is null on the
/// last page; pass it back as `cursor` for the next one.
export async function listChangeLog(
  filters: ChangeLogFilters,
  page: { limit?: number; cursor?: number } = {},
): Promise<{ items: ChangeLogItem[]; nextCursor: number | null }> {
  const limit = Math.min(page.limit ?? DEFAULT_CHANGE_LOG_LIMIT, MAX_CHANGE_LOG_LIMIT);
  const rows = await changeLogRepository.findPage(filters, { limit, cursor: page.cursor });
  const hasMore = rows.length > limit;
  const pageRows = hasMore ? rows.slice(0, limit) : rows;
  return {
    items: await enrich(pageRows),
    nextCursor: hasMore ? pageRows[pageRows.length - 1].id : null,
  };
}

function csvCell(v: unknown): string {
  const s = v === null || v === undefined ? "" : String(v);
  // A leading = + - @ would run as a formula when the file is opened in Excel.
  const safe = /^[=+\-@]/.test(s) ? `'${s}` : s;
  return /[",\r\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}

const CSV_HEADERS = ["When", "Table", "Action", "Source", "Changed by", "SKU", "Product", "Entry date", "Shift", "Location", "What changed", "Record ID"];

/// The filtered list as CSV (newest first), read in chunks so a big export
/// doesn't hold the whole table in memory; stops at EXPORT_ROW_CAP rows.
export async function exportChangeLogCsv(filters: ChangeLogFilters): Promise<string> {
  const lines = [CSV_HEADERS.join(",")];
  let cursor: number | undefined;
  while (lines.length - 1 < EXPORT_ROW_CAP) {
    const { items, nextCursor } = await listChangeLog(filters, { limit: EXPORT_CHUNK, cursor });
    // The last chunk can overshoot the cap; trim so it is exact.
    for (const r of items.slice(0, EXPORT_ROW_CAP - (lines.length - 1))) {
      const c = r.context;
      const summary = r.tableName === "system" ? String(asObject(r.newValue).event ?? "System event") : r.summary;
      lines.push(
        [
          r.changedAt.toISOString(),
          r.tableName,
          r.action,
          r.source ?? "",
          r.changedBy?.name ?? "system",
          c?.sku,
          c?.productName,
          c?.entryDate,
          c?.shift ? SHIFT_LABELS[c.shift] : "",
          c?.location ? LOCATION_LABELS[c.location] : "",
          summary,
          r.recordId,
        ]
          .map(csvCell)
          .join(","),
      );
    }
    if (nextCursor === null) break;
    cursor = nextCursor;
  }
  return lines.join("\r\n");
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
