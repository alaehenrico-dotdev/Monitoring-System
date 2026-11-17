import { Button } from "./ui";
import { StickyToast } from "./Toast";

/// The unsaved-changes notice on an entry sheet, shown as a toast in the shared bottom-right stack
/// (not a bar docked into the page) while the sheet has unsaved edits or a save failed. The
/// Review / Discard actions stay in reach while the grid is scrolled. Hidden when there is nothing
/// unsaved.
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
  const failedNow = failed && !saving;
  return (
    <StickyToast
      show={pendingCount > 0}
      variant={failedNow ? "error" : "warning"}
      failed={failedNow}
      actions={
        <>
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
        </>
      }
    >
      {saving
        ? "Saving…"
        : failedNow
          ? "Could not save. Your edits are kept."
          : `${pendingCellCount} unsaved change${pendingCellCount === 1 ? "" : "s"} in ${pendingCount} product${pendingCount === 1 ? "" : "s"}`}
    </StickyToast>
  );
}
