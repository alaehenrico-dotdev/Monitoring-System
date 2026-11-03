import { Button } from "./ui";

/// A slim bar pinned to the bottom of the viewport while an entry sheet has unsaved edits (or
/// a save failed), so the save state and the Review / Discard actions stay in reach while the
/// grid is scrolled. Hidden when there is nothing unsaved.
export function EntrySaveBar({
  pendingCount,
  pendingCellCount,
  saving,
  failed,
  onReview,
  onDiscard,
  onRetry,
}: {
  pendingCount: number;
  pendingCellCount: number;
  saving: boolean;
  failed: boolean;
  onReview: () => void;
  onDiscard: () => void;
  onRetry: () => void;
}) {
  if (pendingCount === 0) return null;
  const failedNow = failed && !saving;
  return (
    <div className={`ae-entry-savebar${failedNow ? " ae-entry-savebar--failed" : ""} no-print`} role="status" aria-live="polite">
      <span className="ae-entry-savebar-text">
        {saving
          ? "Saving…"
          : failedNow
            ? "Could not save. Your edits are kept."
            : `${pendingCellCount} unsaved change${pendingCellCount === 1 ? "" : "s"} in ${pendingCount} product${pendingCount === 1 ? "" : "s"}`}
      </span>
      <span className="ae-entry-savebar-actions">
        <Button type="button" variant="secondary" size="sm" onClick={onDiscard} disabled={saving}>
          Discard
        </Button>
        {failedNow ? (
          <Button type="button" size="sm" onClick={onRetry}>
            Retry save
          </Button>
        ) : (
          <Button type="button" size="sm" onClick={onReview} disabled={saving}>
            Review and save
          </Button>
        )}
      </span>
    </div>
  );
}
