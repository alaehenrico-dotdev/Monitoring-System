import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  describeWhen,
  fetchCellHistory,
  type CellChange,
} from "../utils/cellHistory";

export interface CellHistoryTarget {
  x: number;
  y: number;
  /// change_log table backing this grid ("daily_online_stock", ...).
  table: string;
  /// The daily-stock row id. Absent on a row that has never been saved.
  recordId?: number;
  colKey: string;
  columnLabel: string;
  productName: string;
}

/**
 * "View history" for one grid cell - the last ten edits to this product +
 * column, as when / who / old -> new.
 *
 * Same panel treatment as every other floating surface (.ae-col-menu:
 * charcoal, 0.5px edge, 8px radius), portaled for the same clipping reasons.
 *
 * A row that has never been saved carries no database id, so there is
 * genuinely nothing to look up; that renders as the empty state rather than
 * a spinner that never resolves.
 */
export function CellHistoryPopover({
  target,
  onClose,
}: {
  target: CellHistoryTarget;
  onClose: () => void;
}) {
  const [entries, setEntries] = useState<CellChange[] | null>(null);
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ left: target.x, top: target.y });

  useEffect(() => {
    if (target.recordId === undefined) {
      setEntries([]);
      return;
    }
    let cancelled = false;
    fetchCellHistory(target.table, target.recordId, target.colKey).then((all) => {
      if (!cancelled) setEntries(all);
    });
    return () => {
      cancelled = true;
    };
  }, [target.table, target.recordId, target.colKey]);

  // Re-measured when the entries land, since the panel's height is not known
  // until they do - otherwise a 10-row history opened near the bottom of the
  // screen would hang off it.
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const { width, height } = el.getBoundingClientRect();
    setPos({
      left: Math.max(8, Math.min(target.x, window.innerWidth - width - 8)),
      top: Math.max(8, Math.min(target.y, window.innerHeight - height - 8)),
    });
    el.focus();
  }, [target.x, target.y, entries]);

  useEffect(() => {
    function onPointerDown(e: MouseEvent) {
      if (!ref.current?.contains(e.target as Node)) onClose();
    }
    window.addEventListener("mousedown", onPointerDown);
    window.addEventListener("scroll", onClose, true);
    window.addEventListener("resize", onClose);
    return () => {
      window.removeEventListener("mousedown", onPointerDown);
      window.removeEventListener("scroll", onClose, true);
      window.removeEventListener("resize", onClose);
    };
  }, [onClose]);

  return createPortal(
    <div
      ref={ref}
      role="dialog"
      aria-label={`History for ${target.productName}, ${target.columnLabel}`}
      tabIndex={-1}
      className="ae-col-menu ae-cell-history no-print"
      style={{ left: pos.left, top: pos.top }}
      onKeyDown={(e) => {
        if (e.key === "Escape") {
          e.preventDefault();
          onClose();
        }
      }}
    >
      <div className="ae-col-menu-title">
        {target.productName} · {target.columnLabel}
      </div>

      {entries === null && <div className="ae-cell-history-note">Loading…</div>}

      {entries?.length === 0 && (
        <div className="ae-cell-history-note">No recorded changes to this cell</div>
      )}

      {entries?.map((e, i) => (
        <div key={`${e.changedAt}-${i}`} className="ae-cell-history-row">
          <div className="ae-cell-history-change">
            {/* A CREATE has no prior value - showing "0 →" would claim the
                cell was explicitly zero before, which it never was. */}
            {e.oldValue === null ? (
              <span>set to {e.newValue.toLocaleString()}</span>
            ) : (
              <span>
                {e.oldValue.toLocaleString()} &rarr; {e.newValue.toLocaleString()}
              </span>
            )}
          </div>
          <div className="ae-cell-history-meta">
            {e.who ?? "Unknown user"} · <time dateTime={e.changedAt}>{describeWhen(e.changedAt)}</time>
          </div>
        </div>
      ))}
    </div>,
    document.body,
  );
}
