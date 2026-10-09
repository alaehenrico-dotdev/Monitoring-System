import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Button } from "./ui";
import { SyncIcon } from "./icons";
import { showToast } from "./Toast";
import type { GridColumn, GridRow } from "./StockGrid";
import {
  copyableColumns,
  defaultCopyKeys,
  describePeriod,
  planCopyPrevious,
  previousPeriod,
  type CopyEdit,
  type CopySource,
  type Period,
} from "../utils/copyPrevious";

interface CopyPreviousButtonProps {
  /// The sheet currently open - what "previous" is measured back from.
  current: Period;
  columns: GridColumn[];
  /// Last-saved rows for the open sheet (not the pending-overlaid ones).
  rows: GridRow[] | null;
  /// The page's own grid GET, reused rather than adding an endpoint.
  fetchPeriod: (date: string, shift: Period["shift"]) => Promise<GridRow[]>;
  /// Staged edits, so a cell the encoder has already typed into is protected.
  pending: Record<number, Record<string, number>>;
  getSavedValue: (productId: number, key: string) => number | undefined;
  /// Routed to the page's stageMany, which makes the whole copy ONE undo step.
  onApply: (edits: CopyEdit[]) => void;
  /// Read-only role, or a sheet that can't be edited right now.
  disabled?: boolean;
}

/**
 * "Copy previous" - fills this sheet's movement columns from the previous
 * shift (or the same shift a day earlier), for product lines that run much
 * the same way period to period.
 *
 * Column choice is deliberately opt-in per column rather than all-or-nothing:
 * Production (In) genuinely does repeat, while Fulfillment/Delivery (Out) is
 * different every shift, and copying the latter forward would manufacture
 * figures that look entered but were never counted.
 *
 * The popover reuses .ae-col-menu, the same charcoal/0.5px/8px panel as the
 * column header menu, rather than introducing a third floating surface.
 */
export function CopyPreviousButton({
  current,
  columns,
  rows,
  fetchPeriod,
  pending,
  getSavedValue,
  onApply,
  disabled,
}: CopyPreviousButtonProps) {
  const [open, setOpen] = useState(false);
  const [source, setSource] = useState<CopySource>("previous-shift");
  const [keys, setKeys] = useState<string[]>(() => defaultCopyKeys(columns));
  const [overwrite, setOverwrite] = useState(false);
  const [busy, setBusy] = useState(false);
  // Anchored on a wrapper, not the Button itself: Button is a plain function
  // component, so a ref passed to it would be dropped under React 18.
  const btnRef = useRef<HTMLSpanElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ left: 0, top: 0 });

  const offered = copyableColumns(columns);
  const from = previousPeriod(current, source);

  useLayoutEffect(() => {
    if (!open) return;
    const anchor = btnRef.current?.getBoundingClientRect();
    const panel = panelRef.current?.getBoundingClientRect();
    if (!anchor || !panel) return;
    // Nudged inside the viewport, same as ColumnHeaderMenu - the toolbar
    // sits near the right edge on a narrow window.
    setPos({
      left: Math.max(8, Math.min(anchor.left, window.innerWidth - panel.width - 8)),
      top: Math.min(anchor.bottom + 6, window.innerHeight - panel.height - 8),
    });
    panelRef.current?.focus();
  }, [open]);

  useEffect(() => {
    if (!open) return;
    function onPointerDown(e: MouseEvent) {
      if (
        !panelRef.current?.contains(e.target as Node) &&
        !btnRef.current?.contains(e.target as Node)
      ) {
        setOpen(false);
      }
    }
    const close = () => setOpen(false);
    window.addEventListener("mousedown", onPointerDown);
    window.addEventListener("scroll", close, true);
    window.addEventListener("resize", close);
    return () => {
      window.removeEventListener("mousedown", onPointerDown);
      window.removeEventListener("scroll", close, true);
      window.removeEventListener("resize", close);
    };
  }, [open]);

  function toggleKey(key: string) {
    setKeys((prev) =>
      prev.includes(key) ? prev.filter((k) => k !== key) : [...prev, key],
    );
  }

  async function apply() {
    if (!rows || keys.length === 0) return;
    setBusy(true);
    try {
      const sourceRows = await fetchPeriod(from.date, from.shift);
      const plan = planCopyPrevious(
        sourceRows.map((r) => ({ productId: r.product.id, entry: r.entry })),
        rows.map((r) => ({ productId: r.product.id, entry: r.entry })),
        keys,
        pending,
        overwrite,
        getSavedValue,
      );

      if (plan.edits.length === 0) {
        showToast(
          plan.protectedCells > 0
            ? `Nothing copied from ${describePeriod(from)} - the ${plan.protectedCells} matching cell${plan.protectedCells === 1 ? "" : "s"} already hold your own edits.`
            : `Nothing to copy from ${describePeriod(from)}.`,
          "info",
        );
      } else {
        // One call, so the whole copy is a single Ctrl+Z.
        onApply(plan.edits);
        const n = plan.edits.length;
        const kept = plan.protectedCells
          ? ` (${plan.protectedCells} of your own edits kept)`
          : "";
        showToast(
          `Copied ${n} value${n === 1 ? "" : "s"} from ${describePeriod(from)}${kept}`,
          "success",
        );
      }
      setOpen(false);
    } catch (e) {
      showToast(
        `Couldn't read ${describePeriod(from)}: ${e instanceof Error ? e.message : "request failed"}`,
        "error",
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <span ref={btnRef} style={{ display: "inline-flex" }}>
      <Button
        className="ae-toolbar-save"
        type="button"
        variant="secondary"
        size="sm"
        disabled={disabled || !rows}
        aria-expanded={open}
        aria-haspopup="dialog"
        onClick={() => setOpen((o) => !o)}
        title="Copy movement figures from the previous shift or day"
      >
        <SyncIcon />
        <span className="ae-toolbar-btn-label">Copy previous</span>
      </Button>
      </span>

      {open &&
        createPortal(
          <div
            ref={panelRef}
            role="dialog"
            aria-label="Copy from a previous period"
            tabIndex={-1}
            className="ae-col-menu ae-copy-prev no-print"
            style={{ left: pos.left, top: pos.top }}
            onKeyDown={(e) => {
              if (e.key === "Escape") {
                e.preventDefault();
                setOpen(false);
              }
            }}
          >
            <div className="ae-col-menu-title">Copy from</div>
            {(
              [
                ["previous-shift", "Previous shift"],
                ["previous-day", "Previous day (same shift)"],
              ] as const
            ).map(([value, label]) => (
              <label key={value} className="ae-copy-prev-row">
                <input
                  type="radio"
                  name="ae-copy-prev-source"
                  checked={source === value}
                  onChange={() => setSource(value)}
                />
                <span>{label}</span>
              </label>
            ))}
            <div className="ae-copy-prev-from">{describePeriod(from)}</div>

            <div className="ae-col-menu-title">Columns</div>
            {offered.map((c) => (
              <label key={c.key} className="ae-copy-prev-row">
                <input
                  type="checkbox"
                  checked={keys.includes(c.key)}
                  onChange={() => toggleKey(c.key)}
                />
                <span>{c.label}</span>
              </label>
            ))}

            <label className="ae-copy-prev-row ae-copy-prev-overwrite">
              <input
                type="checkbox"
                checked={overwrite}
                onChange={(e) => setOverwrite(e.target.checked)}
              />
              <span>Overwrite my edits</span>
            </label>

            <div className="ae-copy-prev-actions">
              <Button
                type="button"
                variant="secondary"
                size="sm"
                onClick={() => setOpen(false)}
              >
                Cancel
              </Button>
              <Button
                type="button"
                size="sm"
                onClick={apply}
                disabled={busy || keys.length === 0}
              >
                {busy ? "Copying…" : "Copy"}
              </Button>
            </div>
          </div>,
          document.body,
        )}
    </>
  );
}
