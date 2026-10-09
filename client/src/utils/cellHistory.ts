import { getCellHistory, type CellHistoryEntry } from "../api/changeLog";

/**
 * change_log lookups for one grid cell's provenance - the hover tooltip on
 * every cell (StockGrid's useCellHistoryTitle) and the "View history"
 * popover on a cell's right-click menu.
 *
 * Both go through /change-log/cell rather than the full /change-log list.
 * That list is Supervisor/Admin-only, so the hover tooltip had been silently
 * 403-ing for the encoders who spend all day in these grids - the error was
 * swallowed into an empty history, which reads exactly like "this cell has
 * never been edited". The per-cell endpoint is open to every role that can
 * open the grid and returns only the one field asked for.
 *
 * The trade: this caches per (table, record, field) instead of per record, so
 * hovering across a row costs one small request per column rather than one
 * larger request for the whole row. Each response is now a handful of entries
 * for a single field instead of up to 500 whole-row snapshots, and nothing is
 * requested until a cell is actually hovered or right-clicked.
 */

export type CellChange = CellHistoryEntry;

const historyCache = new Map<string, Promise<CellChange[]>>();

const cacheKey = (table: string, recordId: number, field: string) =>
  `${table}:${recordId}:${field}`;

/// Matches the server's own default/max for this endpoint.
const HISTORY_LIMIT = 10;

export function fetchCellHistory(
  table: string,
  recordId: number,
  field: string,
): Promise<CellChange[]> {
  const key = cacheKey(table, recordId, field);
  const hit = historyCache.get(key);
  if (hit) return hit;
  const req = getCellHistory({
    tableName: table,
    recordId,
    field,
    limit: HISTORY_LIMIT,
  }).catch(() => {
    // A failed lookup shouldn't be cached as a permanent "no history" -
    // drop it so the next hover retries.
    historyCache.delete(key);
    return [] as CellChange[];
  });
  historyCache.set(key, req);
  return req;
}

/// Dropped after a save, so the next hover/right-click sees the edit that was
/// just written rather than the pre-save snapshot. Called with no arguments
/// from the entry pages, which have no cheap way to know which rows the save
/// actually touched.
export function invalidateRecordHistory(table?: string, recordId?: number): void {
  if (table === undefined || recordId === undefined) {
    historyCache.clear();
    return;
  }
  const prefix = `${table}:${recordId}:`;
  for (const key of [...historyCache.keys()]) {
    if (key.startsWith(prefix)) historyCache.delete(key);
  }
}

/// The most recent change to this cell - what the hover tooltip reports.
export function lastChange(entries: CellChange[]): CellChange | undefined {
  return entries[0];
}

export function describeWhen(iso: string): string {
  const then = new Date(iso).getTime();
  if (!Number.isFinite(then)) return "";
  const mins = Math.round((Date.now() - then) / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  return new Date(iso).toLocaleDateString();
}
