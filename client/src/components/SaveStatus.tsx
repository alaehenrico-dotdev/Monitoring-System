import { formatClock } from "../utils/dateFormat";
import { AlertTriangleIcon, CheckIcon } from "./icons";
import { Spinner } from "./Spinner";

export type SaveState = "idle" | "saving" | "saved" | "failed";

/**
 * "Saved 21:42" / "Saving…" / "Failed – retry", next to the Save button.
 *
 * Each state has its own words and icon, so none depends on colour: the check,
 * the spinner and the warning triangle carry the meaning, the colour only
 * reinforces it. It is a polite live region, so a screen reader announces the
 * result of a save without being interrupted mid-sentence. Nothing at all is
 * shown before the first save (the region stays, empty, so the first message is
 * still announced).
 */
export function SaveStatus({ state, savedAt, onRetry }: { state: SaveState; savedAt?: number; onRetry?: () => void }) {
  return (
    <span role="status" aria-live="polite" className={`ae-savestatus ae-savestatus--${state}`}>
      {state === "saving" && (
        <>
          <Spinner size="sm" />
          <span>Saving…</span>
        </>
      )}
      {state === "saved" && savedAt !== undefined && (
        <>
          <CheckIcon />
          <span>Saved {formatClock(savedAt)}</span>
        </>
      )}
      {state === "failed" && (
        <>
          <AlertTriangleIcon />
          <span>Failed –</span>
          <button type="button" className="ae-savestatus-retry" onClick={onRetry} title="Try saving again">
            retry
          </button>
        </>
      )}
    </span>
  );
}
