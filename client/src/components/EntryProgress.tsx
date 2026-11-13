import { useEffect, useMemo } from "react";
import { entryProgress, nextBlank } from "../utils/entryProgress";
import { requestQuickJump } from "../utils/quickJumpTarget";
import { colors } from "../theme";
import { Button } from "./ui";

interface RowLike {
  product: { id: number; category: string };
  isSaved?: boolean;
}

/// The product whose cell has focus right now (cells carry data-cell="id:key"),
/// so "next blank" continues from where the encoder is, not from the top.
function focusedProductId(): number | null {
  const el = document.activeElement;
  const cell = el instanceof HTMLElement ? el.dataset.cell : undefined;
  if (!cell) return null;
  const id = Number(cell.split(":")[0]);
  return Number.isFinite(id) ? id : null;
}

/// "34 of 52 entered" with a bar, and a Next blank button (Alt+N) that jumps to the
/// next product not yet entered. The jump is the grid's own Ctrl+K quick-jump -
/// it opens the category, scrolls to the row and focuses its first cell - so it
/// behaves exactly like jumping to a product by name.
///
/// Counts every product on the sheet, ignoring the search and category filters:
/// the question it answers is "is this shift finished", not "is this view". A
/// product counts once it is saved or has a staged edit, so a product that really
/// has nothing this shift needs a 0 (or Clear all on its category) to count - which
/// is also what makes a skipped product stand out instead of passing as zero.
export function EntryProgress({
  rows,
  pending,
  enabled,
  isShown,
}: {
  rows: RowLike[] | null;
  pending: Record<number, Record<string, unknown>>;
  enabled: boolean;
  /// Whether a product is in the grid right now (not hidden by the search or
  /// category filter). A jump to a hidden row would land nowhere - and the grid
  /// would keep the request waiting - so the jump only walks the shown ones.
  isShown: (productId: number) => boolean;
}) {
  const progress = useMemo(() => entryProgress(rows, pending), [rows, pending]);
  const reachable = useMemo(() => ({ ...progress, blank: progress.blank.filter(isShown) }), [progress, isShown]);

  function jump() {
    const id = nextBlank(reachable, focusedProductId());
    if (id !== null) requestQuickJump(id);
  }

  // Alt+N, while the sheet (not a dialog) is what the encoder is working in.
  useEffect(() => {
    if (!enabled) return;
    function onKey(e: KeyboardEvent) {
      if (!e.altKey || e.ctrlKey || e.metaKey || e.shiftKey || e.key.toLowerCase() !== "n") return;
      e.preventDefault();
      const id = nextBlank(reachable, focusedProductId());
      if (id !== null) requestQuickJump(id);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [enabled, reachable]);

  if (progress.total === 0) return null;
  const complete = progress.blank.length === 0;
  const percent = Math.round((progress.done / progress.total) * 100);

  return (
    <div
      role="status"
      aria-live="polite"
      style={{
        display: "flex",
        alignItems: "center",
        gap: 12,
        flexWrap: "wrap",
        margin: "0 0 10px",
        padding: "6px 10px",
        border: `1px solid ${colors.border}`,
        borderRadius: 6,
        background: colors.paperAlt,
        fontSize: "calc(12.5px * var(--ae-fs, 1))",
        color: colors.ink,
      }}
    >
      <span>
        <strong>{progress.done}</strong> of {progress.total} products entered
        {complete ? " - all done" : ` - ${progress.blank.length} left`}
      </span>
      <span
        aria-hidden="true"
        style={{ flex: "1 1 80px", maxWidth: 220, height: 6, borderRadius: 3, background: colors.border, overflow: "hidden" }}
      >
        <span style={{ display: "block", width: `${percent}%`, height: "100%", background: colors.green, transition: "width 160ms ease-out" }} />
      </span>
      {!complete && (
        <Button
          type="button"
          variant="secondary"
          size="sm"
          onClick={jump}
          disabled={reachable.blank.length === 0}
          title={reachable.blank.length === 0 ? "The products left are hidden by the search or category filter" : "Jump to the next product not entered yet (Alt+N)"}
        >
          Next blank (Alt+N)
        </Button>
      )}
    </div>
  );
}
