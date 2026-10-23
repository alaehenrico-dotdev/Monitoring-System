import { Link } from "react-router-dom";
import type { DayClosure, EntryLocation } from "../api/ops";
import type { Shift } from "../types";
import { PAGE_LABEL, other, reportLink, useFinishDay, type FinishDayOptions } from "../hooks/useFinishDay";
import { formatDateDisplay } from "../utils/dateFormat";
import { SHIFT_LABELS } from "../utils/shift";
import { Button } from "./ui";
import { LockCheckIcon, LockIcon, ReportIcon } from "./icons";

/**
 * Shown above a sheet that has been finished: it is read-only, and says why,
 * who locked it, and the two ways forward - open the report for it, or (for an
 * admin) unlock it from the Admin Queue.
 */
export function DayLockBanner({
  date,
  shift,
  location,
  closure,
  isAdmin,
}: {
  date: string;
  shift: Shift;
  location: EntryLocation;
  closure: DayClosure | null;
  isAdmin: boolean;
}) {
  return (
    <div className="ae-day-lock" role="status">
      <span className="ae-day-lock-icon" aria-hidden>
        <LockIcon />
      </span>
      <div className="ae-day-lock-text">
        <strong>
          {PAGE_LABEL[location]} · {formatDateDisplay(date)} ·{" "}
          {SHIFT_LABELS[shift]} is finished and locked.
        </strong>
        <span>
          {closure?.closedBy ? `Finished by ${closure.closedBy.name}. ` : ""}
          {closure?.entriesOnly === false
            ? "Closed by an admin, so counts are locked too. "
            : `The ${PAGE_LABEL[other(location)]} page is locked separately. A transfer change on it that would also change this page needs an admin's approval. `}
          {isAdmin
            ? "Use Unlock in the toolbar to change it."
            : "Use Request unlock in the toolbar if something must change."}
        </span>
      </div>
      <div className="ae-day-lock-actions">
        <Link
          to={reportLink(date)}
          className="ae-btn ae-btn-secondary ae-btn-sm"
          style={{ textDecoration: "none" }}
        >
          <ReportIcon /> Generate report
        </Link>
        {isAdmin && (
          <Link
            to="/admin-queue"
            className="ae-btn ae-btn-secondary ae-btn-sm"
            style={{ textDecoration: "none" }}
          >
            Admin Queue
          </Link>
        )}
      </div>
    </div>
  );
}

/**
 * Shown above a sheet that cannot be entered yet because an earlier day is not
 * finished: days are finished in order. The sheet is read-only until then, and
 * the button takes the encoder straight to the day that is waiting.
 */
export function FinishEarlierDayBanner({
  blockedBy,
  onGo,
}: {
  blockedBy: { entryDate: string; shift: Shift };
  onGo: (date: string, shift: Shift) => void;
}) {
  return (
    <div className="ae-day-lock" role="status">
      <span className="ae-day-lock-icon" aria-hidden>
        <LockIcon />
      </span>
      <div className="ae-day-lock-text">
        <strong>
          Finish {formatDateDisplay(blockedBy.entryDate)} ·{" "}
          {SHIFT_LABELS[blockedBy.shift]} first.
        </strong>
        <span>
          Days are finished in order, so this sheet is read-only until that
          one is finished.
        </span>
      </div>
      <div className="ae-day-lock-actions">
        <Button
          type="button"
          variant="secondary"
          size="sm"
          onClick={() => onGo(blockedBy.entryDate, blockedBy.shift)}
        >
          Go to {formatDateDisplay(blockedBy.entryDate)}
        </Button>
      </div>
    </div>
  );
}

/**
 * The encoder's "Finish day" button: a plain toolbar button around `useFinishDay`.
 * It glows once every product has a saved entry and nothing is left unsaved.
 */
export function FinishDayButton(props: FinishDayOptions) {
  const { location, disabled, disabledReason } = props;
  const { open, ready, dialogs, otherName } = useFinishDay(props);
  return (
    <>
      <Button
        className={`ae-toolbar-publish${ready ? " ae-toolbar-publish--ready" : ""}`}
        type="button"
        variant="secondary"
        size="sm"
        onClick={() => void open()}
        aria-disabled={disabled || undefined}
        title={
          disabled
            ? disabledReason
            : ready
              ? `Every product is saved - lock the ${PAGE_LABEL[location]} page`
              : `Lock the ${PAGE_LABEL[location]} page (${otherName} stays open)`
        }
      >
        <LockCheckIcon />
        <span className="ae-toolbar-btn-label">Finish day</span>
      </Button>
      {dialogs}
    </>
  );
}
