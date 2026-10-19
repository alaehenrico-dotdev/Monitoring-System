import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { finishDay, getFinishSummary, type EntryLocation, type FinishSummary } from "../api/ops";
import type { Shift } from "../types";
import { useRealtimeVersion } from "../context/RealtimeContext";
import { formatDateDisplay } from "../utils/dateFormat";
import { SHIFT_LABELS } from "../utils/shift";
import { colors } from "../theme";
import { ConfirmDialog } from "../components/ConfirmDialog";
import { Modal } from "../components/Modal";
import { Button } from "../components/ui";
import { ReportIcon } from "../components/icons";
import { useBusyAction } from "./useBusyAction";
import { useResetOnKeyChange } from "./useResetOnKeyChange";

export const reportLink = (date: string) => `/daily-report?date=${date}&auto=1`;

export const PAGE_LABEL: Record<EntryLocation, string> = { ONLINE: "Online", OFFLINE: "Offline" };
export const other = (location: EntryLocation): EntryLocation => (location === "ONLINE" ? "OFFLINE" : "ONLINE");

export interface FinishDayOptions {
  date: string;
  shift: Shift;
  /// The entry page this finishes - only that page is locked.
  location: EntryLocation;
  /// True while there are unsaved edits - they would be locked out unsaved.
  disabled: boolean;
  disabledReason?: string;
  onFinished: () => void;
  onError: (message: string) => void;
  /// Worth a look before locking (for example products below zero stock). Listed
  /// in the confirmation; they never block it.
  warnings?: string[];
  /// False when this sheet cannot be finished right now (already finished, or an
  /// earlier day is pending): the hook then makes no request at all. Default true.
  enabled?: boolean;
  /// A supervisor/admin may finish over negative stock by giving a reason; an
  /// encoder cannot (the server enforces the same). Default false.
  canSignOff?: boolean;
}

/**
 * The encoder's "Finish day", as a hook: the state, the check of what is about
 * to be locked, and the two dialogs (confirm, then done). `FinishDayButton`
 * wraps it in a plain button; the entry toolbar wraps it in a split button. One
 * implementation, two ways to press it.
 *
 * The confirmation says exactly what happens (the page is locked for everyone,
 * what is saved, when the report is saved) and lists what is wrong: nothing
 * saved blocks it (the confirm button is disabled and the dialog says why),
 * products still missing or any `warnings` are shown but do not block.
 *
 * `ready` is true once every product has a saved entry on this page and nothing
 * is left unsaved - the cue to glow - but the action is never disabled: a click
 * with unsaved edits says why it cannot go ahead, and one with products still
 * missing asks before locking a half-done day.
 */
export function useFinishDay({ date, shift, location, disabled, disabledReason, onFinished, onError, warnings = [], enabled = true, canSignOff = false }: FinishDayOptions) {
  const [step, setStep] = useState<"idle" | "confirm" | "done">("idle");
  // Whether finishing this page also saved the day's report (the other page was
  // already finished), for the "done" message.
  const [reportSaved, setReportSaved] = useState(false);
  const [summary, setSummary] = useState<FinishSummary | null>(null);
  // How complete the sheet is right now, for the glow (kept apart from
  // `summary`, which is the snapshot the open dialog is showing).
  const [progress, setProgress] = useState<FinishSummary | null>(null);
  const [signOffReason, setSignOffReason] = useState("");
  const action = useBusyAction();
  const realtimeVersion = useRealtimeVersion();

  useEffect(() => {
    if (!enabled) return;
    let current = true;
    getFinishSummary(date, shift, location)
      .then((s) => current && setProgress(s))
      .catch(() => current && setProgress(null));
    return () => {
      current = false;
    };
  }, [date, shift, location, realtimeVersion, enabled]);

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
      setSignOffReason("");
      setStep("confirm");
    } catch (e) {
      onError(e instanceof Error ? e.message : "Couldn't check this shift");
    }
  }

  async function confirm() {
    await action.run(async () => {
      try {
        const result = negatives.length > 0 ? await finishDay(date, shift, location, signOffReason.trim()) : await finishDay(date, shift, location);
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
  const ready = enabled && !disabled && !!progress && !progress.alreadyFinished && complete(mine(progress));
  const nothingSaved = summary ? mine(summary).saved === 0 : false;
  const negatives = summary?.negatives ?? [];
  // Negative stock blocks an encoder, and needs a reason from a supervisor.
  const negativeBlocked = negatives.length > 0 && (!canSignOff || signOffReason.trim().length < 3);
  const thin = summary ? !complete(mine(summary)) && !nothingSaved : false;
  const otherName = PAGE_LABEL[other(location)];
  const otherDone = summary ? (location === "ONLINE" ? summary.offlineLocked : summary.onlineLocked) : false;

  const dialogs = (
    <>
      {step === "confirm" && summary && (
        <ConfirmDialog
          title={`Finish ${PAGE_LABEL[location]} · ${formatDateDisplay(date)} · ${SHIFT_LABELS[shift]}?`}
          confirmLabel="Finish & lock"
          busy={action.busy}
          confirmDisabled={nothingSaved || negativeBlocked}
          onConfirm={() => void confirm()}
          onCancel={() => setStep("idle")}
        >
          <p style={{ margin: "0 0 10px" }}>
            This locks the {PAGE_LABEL[location]} entries for this shift. The {otherName} page is not affected - it is finished separately, by its own encoder
            {otherDone ? " (already done), so the Daily Report is saved now." : ", and the Daily Report is saved once both pages are finished."} Nobody can edit{" "}
            {PAGE_LABEL[location]} afterwards unless an admin unlocks it, and a transfer change that would also alter the {otherName} page needs an admin's approval.
          </p>
          <ul style={{ margin: "0 0 10px", paddingLeft: 18 }}>
            <li>
              {PAGE_LABEL[location]}: {mine(summary).saved} of {mine(summary).total} products saved
            </li>
          </ul>
          {nothingSaved && (
            <p role="alert" style={{ margin: 0, color: colors.danger }}>
              Blocked: nothing has been saved on the {PAGE_LABEL[location]} page for this shift yet, so there is nothing to finish.
            </p>
          )}
          {negatives.length > 0 && (
            <div role="alert" style={{ margin: "0 0 10px", color: colors.danger }}>
              <p style={{ margin: "0 0 6px" }}>
                {negatives.length} product{negatives.length === 1 ? "" : "s"} end{negatives.length === 1 ? "s" : ""} below zero stock - usually an Out entered before its In:
              </p>
              <ul style={{ margin: "0 0 6px", paddingLeft: 18 }}>
                {negatives.slice(0, 8).map((n) => (
                  <li key={n.productId}>
                    {n.name} ({n.remainingStock})
                  </li>
                ))}
                {negatives.length > 8 && <li>and {negatives.length - 8} more</li>}
              </ul>
              {canSignOff ? (
                <label style={{ display: "block", color: colors.ink }}>
                  Reason to finish with negative stock (recorded in the Change Log)
                  <input
                    className="ae-input"
                    style={{ display: "block", width: "100%", marginTop: 4 }}
                    value={signOffReason}
                    onChange={(e) => setSignOffReason(e.target.value)}
                    maxLength={200}
                    placeholder="e.g. Production In arrives next shift"
                  />
                </label>
              ) : (
                <p style={{ margin: 0 }}>Enter the missing In figures, or ask a supervisor to finish this day with a sign-off.</p>
              )}
            </div>
          )}
          {thin && (
            <p style={{ margin: 0, color: colors.warningText }}>Some products have no saved entry yet. Make sure everyone is done before finishing.</p>
          )}
          {warnings.length > 0 && (
            <ul aria-label="Warnings" style={{ margin: "8px 0 0", paddingLeft: 18, color: colors.warningText }}>
              {warnings.map((w) => (
                <li key={w}>{w}</li>
              ))}
            </ul>
          )}
        </ConfirmDialog>
      )}

      {step === "done" && (
        <Modal title="Day finished" onClose={() => setStep("idle")} width={420}>
          <p style={{ fontSize: 13.5, lineHeight: 1.55, margin: 0 }}>
            {PAGE_LABEL[location]} · {formatDateDisplay(date)} · {SHIFT_LABELS[shift]} is saved and locked.{" "}
            {reportSaved ? "The report for it is ready to generate." : `The Daily Report is saved once ${otherName} is finished too.`}
          </p>
          <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 20 }}>
            <Button variant="secondary" onClick={() => setStep("idle")}>
              Close
            </Button>
            <Link to={reportLink(date)} className="ae-btn ae-btn-primary" style={{ textDecoration: "none" }}>
              <ReportIcon /> Generate report
            </Link>
          </div>
        </Modal>
      )}
    </>
  );

  return { open, ready, dialogs, otherName };
}
