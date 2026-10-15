import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import {
  finishDay,
  getFinishSummary,
  type DayClosure,
  type EntryLocation,
  type FinishSummary,
} from "../api/ops";
import type { Shift } from "../types";
import { useBusyAction } from "../hooks/useBusyAction";
import { useResetOnKeyChange } from "../hooks/useResetOnKeyChange";
import { useRealtimeVersion } from "../context/RealtimeContext";
import { formatDateDisplay } from "../utils/dateFormat";
import { SHIFT_LABELS } from "../utils/shift";
import { colors } from "../theme";
import { ConfirmDialog } from "./ConfirmDialog";
import { Modal } from "./Modal";
import { Button } from "./ui";
import { CheckIcon, LockIcon, ReportIcon } from "./icons";

const reportLink = (date: string) => `/daily-report?date=${date}&auto=1`;

const PAGE_LABEL: Record<EntryLocation, string> = { ONLINE: "Online", OFFLINE: "Offline" };
const other = (location: EntryLocation): EntryLocation => (location === "ONLINE" ? "OFFLINE" : "ONLINE");

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
            ? "Unlock it from the Admin Queue to change it."
            : "Ask an admin to unlock it if something must change."}
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
 * The encoder's "Finish day" button. Asks first (it locks the sheet for
 * everyone, and says how much is saved in each grid so a half-done day is
 * noticed), then locks the entries and saves the report snapshot, and finally
 * offers "Generate report" - the natural next step once the entries are done.
 *
 * It glows once every product has a saved entry in both grids (and nothing is
 * left unsaved), as the cue that the day is ready to finish - but it is never
 * disabled: a click with unsaved edits says why it cannot go ahead, and one
 * with products still missing asks before locking a half-done day.
 */
export function FinishDayButton({
  date,
  shift,
  location,
  disabled,
  disabledReason,
  onFinished,
  onError,
}: {
  date: string;
  shift: Shift;
  /// The entry page this button finishes - only that page is locked.
  location: EntryLocation;
  /// True while there are unsaved edits - they would be locked out unsaved.
  disabled: boolean;
  disabledReason?: string;
  onFinished: () => void;
  onError: (message: string) => void;
}) {
  const [step, setStep] = useState<"idle" | "confirm" | "done">("idle");
  // Whether finishing this page also saved the day's report (the other page was
  // already finished), for the "done" message.
  const [reportSaved, setReportSaved] = useState(false);
  const [summary, setSummary] = useState<FinishSummary | null>(null);
  // How complete the sheet is right now, for the glow (kept apart from
  // `summary`, which is the snapshot the open dialog is showing).
  const [progress, setProgress] = useState<FinishSummary | null>(null);
  const action = useBusyAction();
  const realtimeVersion = useRealtimeVersion();

  useEffect(() => {
    let current = true;
    getFinishSummary(date, shift, location)
      .then((s) => current && setProgress(s))
      .catch(() => current && setProgress(null));
    return () => {
      current = false;
    };
  }, [date, shift, location, realtimeVersion]);

  // Which sheet this belongs to can change under an open dialog; never finish
  // the wrong one.
  useResetOnKeyChange(`${date}:${shift}:${location}`, () => setStep("idle"));

  async function open() {
    if (disabled) {
      onError(disabledReason ?? "Save your changes first");
      return;
    }
    try {
      setSummary(await getFinishSummary(date, shift, location));
      setStep("confirm");
    } catch (e) {
      onError(e instanceof Error ? e.message : "Couldn't check this shift");
    }
  }

  async function confirm() {
    await action.run(async () => {
      try {
        const result = await finishDay(date, shift, location);
        setReportSaved(result.reportSaved ?? false);
        setStep("done");
        onFinished();
      } catch (e) {
        setStep("idle");
        onError(e instanceof Error ? e.message : "Couldn't finish the day");
      }
    });
  }

  const complete = (g: { saved: number; total: number }) => g.total > 0 && g.saved >= g.total;
  const mine = (s: FinishSummary) => (location === "ONLINE" ? s.online : s.offline);
  // Only this page's own entries decide whether it is ready: the other page has
  // its own encoder and its own Finish day.
  const ready = !disabled && !!progress && !progress.alreadyFinished && complete(mine(progress));
  const thin = summary ? !complete(mine(summary)) : false;
  const otherName = PAGE_LABEL[other(location)];
  const otherDone = summary ? (location === "ONLINE" ? summary.offlineLocked : summary.onlineLocked) : false;

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
        <CheckIcon />
        <span className="ae-toolbar-btn-label">Finish day</span>
      </Button>

      {step === "confirm" && summary && (
        <ConfirmDialog
          title={`Finish ${PAGE_LABEL[location]} · ${formatDateDisplay(date)} · ${SHIFT_LABELS[shift]}?`}
          confirmLabel="Finish & lock"
          busy={action.busy}
          onConfirm={() => void confirm()}
          onCancel={() => setStep("idle")}
        >
          <p style={{ margin: "0 0 10px" }}>
            This locks the {PAGE_LABEL[location]} entries for this shift. The{" "}
            {otherName} page is not affected - it is finished separately, by its
            own encoder
            {otherDone
              ? " (already done), so the Daily Report is saved now."
              : ", and the Daily Report is saved once both pages are finished."}{" "}
            Nobody can edit {PAGE_LABEL[location]} afterwards unless an admin
            unlocks it, and a transfer change that would also alter the{" "}
            {otherName} page needs an admin's approval.
          </p>
          <ul style={{ margin: "0 0 10px", paddingLeft: 18 }}>
            <li>
              {PAGE_LABEL[location]}: {mine(summary).saved} of{" "}
              {mine(summary).total} products saved
            </li>
          </ul>
          {thin && (
            <p style={{ margin: 0, color: colors.warningText }}>
              Some products have no saved entry yet. Make sure everyone is done
              before finishing.
            </p>
          )}
        </ConfirmDialog>
      )}

      {step === "done" && (
        <Modal title="Day finished" onClose={() => setStep("idle")} width={420}>
          <p style={{ fontSize: 13.5, lineHeight: 1.55, margin: 0 }}>
            {PAGE_LABEL[location]} · {formatDateDisplay(date)} ·{" "}
            {SHIFT_LABELS[shift]} is saved and locked.{" "}
            {reportSaved
              ? "The report for it is ready to generate."
              : `The Daily Report is saved once ${otherName} is finished too.`}
          </p>
          <div
            style={{
              display: "flex",
              justifyContent: "flex-end",
              gap: 8,
              marginTop: 20,
            }}
          >
            <Button variant="secondary" onClick={() => setStep("idle")}>
              Close
            </Button>
            <Link
              to={reportLink(date)}
              className="ae-btn ae-btn-primary"
              style={{ textDecoration: "none" }}
            >
              <ReportIcon /> Generate report
            </Link>
          </div>
        </Modal>
      )}
    </>
  );
}
