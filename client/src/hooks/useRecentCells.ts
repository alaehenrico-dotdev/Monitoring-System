import { useEffect, useRef, useState } from "react";
import { getRecentCells } from "../api/changeLog";

const NO_CELLS: ReadonlySet<string> = new Set();

export interface RecentCellRecord {
  /** The saved row's id in the change log; undefined while it was never saved. */
  recordId: number | undefined;
  /** What the row's cell keys are reported under, e.g. the product id -> "12:fulfillmentOut". */
  cell: string;
  /** Changes whenever the saved row does (its updatedAt), so a save refreshes the lookup. */
  version?: unknown;
}

/**
 * The cells a user changed that are still "news" (from the change log), as a set
 * of `"<cell>:<field>"` - what the gold glow reads, so a past date or another
 * device's edit still shows what was typed. The server decides how long that
 * lasts: until the sheet is finished (or a count is published), then again for
 * whatever is edited after an unlock.
 *
 * Refetches when the SET of saved rows or any row's version changes - not on every
 * render of the parent. The caller usually builds `records` fresh each render, and
 * keying the lookup on that array made every parent re-render cancel the request
 * in flight, so a busy page could go without a glow indefinitely.
 *
 * `refreshKey` is for changes no row shows: finishing, unlocking or publishing
 * moves where the glow ends without touching a single row's updatedAt, so the
 * caller passes the realtime version and the lookup runs again on every change.
 */
export function useRecentCells(table: string | undefined, records: RecentCellRecord[], refreshKey?: unknown): ReadonlySet<string> {
  const saved = records.filter((r): r is RecentCellRecord & { recordId: number } => r.recordId !== undefined);
  const signature = saved.map((r) => `${r.recordId}~${r.cell}~${String(r.version ?? "")}`).join("|");
  const key = table && signature ? `${table}|${signature}|${String(refreshKey ?? "")}` : "";

  // The lookup below reads the rows as of the render that triggered it. Updated in
  // an effect (declared first, so it runs first), not during render.
  const latest = useRef(saved);
  useEffect(() => {
    latest.current = saved;
  });

  const [result, setResult] = useState<{ key: string; cells: ReadonlySet<string> }>({ key: "", cells: NO_CELLS });

  useEffect(() => {
    if (!table || !key) return;
    const rows = latest.current;
    const cellOfRecord = new Map(rows.map((r) => [r.recordId, r.cell] as const));
    let cancelled = false;
    // Debounced: a burst of changes (typing, a multi-cell save, realtime refetches)
    // costs one lookup, not one per change.
    const timer = setTimeout(() => {
      getRecentCells(
        table,
        rows.map((r) => r.recordId),
      )
        .then((byRecord) => {
          if (cancelled) return;
          const cells = new Set<string>();
          for (const [rid, fields] of Object.entries(byRecord)) {
            const cell = cellOfRecord.get(Number(rid));
            if (cell !== undefined) fields.forEach((f) => cells.add(`${cell}:${f}`));
          }
          setResult({ key, cells });
        })
        .catch(() => {
          // Decoration only - a failed lookup just means no glow.
        });
    }, 250);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [table, key]);

  // A result only applies to the record set it was fetched for, so switching
  // dates never flashes the previous date's glow while the lookup is in flight.
  return result.key === key ? result.cells : NO_CELLS;
}
