import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { requestCorrection, type CorrectionTable } from "../api/ops";
import {
  describeWhen,
  fetchCellHistory,
  type CellChange,
} from "../utils/cellHistory";

const CORRECTABLE_TABLES = new Set(["daily_online_stock", "daily_offline_stock", "manual_counts"]);

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
  const [fetched, setEntries] = useState<CellChange[] | null>(null);
  // Never-saved rows have nothing to look up: derive the empty state instead
  // of setting it from an effect.
  const entries = useMemo(
    () => (target.recordId === undefined ? [] : fetched),
    [target.recordId, fetched],
  );
  const ref = useRef<HTMLDivElement>(null);
  // "Request correction": a figure is not overwritten silently - the request
  // carries a reason and waits for an admin (see api/ops.ts, CorrectionsPage).
  const [requesting, setRequesting] = useState(false);
  const [proposed, setProposed] = useState("");
  const [reason, setReason] = useState("");
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const canRequest = target.recordId !== undefined && CORRECTABLE_TABLES.has(target.table);

  async function submitRequest() {
    if (target.recordId === undefined) return;
    const value = Number(proposed);
    if (proposed.trim() === "" || !Number.isFinite(value) || value < 0) {
      setFormError("Enter the corrected figure (0 or more).");
      return;
    }
    if (reason.trim().length < 5) {
      setFormError("Give a reason (at least 5 characters).");
      return;
    }
    setSending(true);
    setFormError(null);
    try {
      await requestCorrection({
        tableName: target.table as CorrectionTable,
        recordId: target.recordId,
        field: target.colKey,
        proposedValue: value,
        reason: reason.trim(),
      });
      setSent(true);
      setRequesting(false);
    } catch (e) {
      setFormError(e instanceof Error ? e.message : "Could not send the request.");
    } finally {
      setSending(false);
    }
  }
  const [pos, setPos] = useState({ left: target.x, top: target.y });

  useEffect(() => {
    if (target.recordId === undefined) return;
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

      {canRequest && !requesting && !sent && (
        <button
          type="button"
          className="ae-btn ae-btn-solid ae-btn-sm"
          style={{ margin: "8px 10px 4px" }}
          onClick={() => setRequesting(true)}
        >
          Request correction…
        </button>
      )}
      {sent && <div className="ae-cell-history-note">Correction requested - an admin will review it.</div>}
      {requesting && (
        <div style={{ display: "grid", gap: 6, padding: "8px 10px" }}>
          <input
            type="number" onWheel={(e) => e.currentTarget.blur()}
            min={0}
            step="any"
            className="ae-input"
            aria-label="Corrected figure"
            placeholder="Corrected figure"
            value={proposed}
            onChange={(e) => setProposed(e.target.value)}
          />
          <textarea
            className="ae-input"
            aria-label="Reason for the correction"
            placeholder="Why is the current figure wrong?"
            rows={2}
            maxLength={500}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            style={{ height: "auto", padding: 6 }}
          />
          {formError && <div role="alert" style={{ fontSize: 12, color: "var(--ae-danger-text)" }}>{formError}</div>}
          <div style={{ display: "flex", gap: 6, justifyContent: "flex-end" }}>
            <button type="button" className="ae-btn ae-btn-solid ae-btn-sm" onClick={() => setRequesting(false)}>
              Cancel
            </button>
            <button type="button" className="ae-btn ae-btn-solid ae-btn-sm" disabled={sending} onClick={() => void submitRequest()}>
              {sending ? "Sending…" : "Send request"}
            </button>
          </div>
        </div>
      )}
    </div>,
    document.body,
  );
}
