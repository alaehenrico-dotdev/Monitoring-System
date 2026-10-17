import { useEffect, useState } from "react";
import { finishThrough, previewFinishThrough, type EntryLocation, type FinishPlan } from "../api/ops";
import { useBusyAction } from "../hooks/useBusyAction";
import { useResetOnKeyChange } from "../hooks/useResetOnKeyChange";
import { formatDateDisplay } from "../utils/dateFormat";
import { getCurrentShiftAndDate, SHIFT_LABELS } from "../utils/shift";
import { colors } from "../theme";
import { DatePicker } from "./DatePicker";
import { Modal } from "./Modal";
import { Button } from "./ui";
import { LockCheckIcon } from "./icons";

const PAGE_LABEL: Record<EntryLocation, string> = { ONLINE: "Online", OFFLINE: "Offline" };

/**
 * "Finish through…": the encoder's catch-up. Days are finished in order, so a
 * backlog of pending days blocks every newer one. Instead of finishing them one
 * by one, the encoder names the latest date they are sure of and every
 * unfinished shift of THIS page up to it is finished together, oldest first,
 * all or nothing.
 *
 * It is a plan before it is an act: the dialog shows exactly what would be
 * locked. Problems that make a lock wrong (negative stock, a date that has not
 * happened, a span too big to review) block it; softer ones (an empty day,
 * items still awaiting release, no count) must be acknowledged first.
 */
export function FinishThroughButton({
  defaultDate,
  location,
  disabled,
  disabledReason,
  onFinished,
  onError,
}: {
  /// Where the date starts: the day to finish through, as "YYYY-MM-DD".
  defaultDate: string;
  location: EntryLocation;
  /// True while there are unsaved edits - they would be locked out unsaved.
  disabled: boolean;
  disabledReason?: string;
  onFinished: () => void;
  onError: (message: string) => void;
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button
        type="button"
        variant="secondary"
        size="sm"
        onClick={() => {
          if (disabled) onError(disabledReason ?? "Save your changes first");
          else setOpen(true);
        }}
        aria-disabled={disabled || undefined}
        title={disabled ? disabledReason : `Earlier days are still unfinished: finish every ${PAGE_LABEL[location]} shift up to a date, oldest first`}
      >
        <LockCheckIcon />
        <span className="ae-toolbar-btn-label">Finish pending days…</span>
      </Button>
      {open && (
        <FinishThroughDialog
          defaultDate={defaultDate}
          location={location}
          onClose={() => setOpen(false)}
          onFinished={onFinished}
          onError={onError}
        />
      )}
    </>
  );
}

export function FinishThroughDialog({
  defaultDate,
  location,
  onClose,
  onFinished,
  onError,
}: {
  defaultDate: string;
  location: EntryLocation;
  onClose: () => void;
  onFinished: () => void;
  onError: (message: string) => void;
}) {
  const [through, setThrough] = useState(defaultDate);
  // The plan for `through`, tagged with the date it is for so a slow answer for
  // an earlier pick is never shown against the current one.
  const [plan, setPlan] = useState<{ through: string; plan: FinishPlan } | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [acknowledged, setAcknowledged] = useState(false);
  const [done, setDone] = useState<number | null>(null);
  const action = useBusyAction();
  const page = PAGE_LABEL[location];

  useResetOnKeyChange(through, () => {
    setPlan(null);
    setLoadError(null);
    setAcknowledged(false);
  });

  useEffect(() => {
    let current = true;
    previewFinishThrough(through, location)
      .then((p) => current && setPlan({ through, plan: p }))
      .catch((e) => current && setLoadError(e instanceof Error ? e.message : "Couldn't check that date"));
    return () => {
      current = false;
    };
  }, [through, location]);

  const ready = plan?.through === through ? plan.plan : null;
  const needsAck = (ready?.warnings.length ?? 0) > 0;
  const canConfirm = !!ready && ready.canFinish && (!needsAck || acknowledged);

  async function confirm() {
    await action.run(async () => {
      try {
        const result = await finishThrough(through, location, acknowledged);
        setDone(result.finished);
        onFinished();
      } catch (e) {
        onError(e instanceof Error ? e.message : "Couldn't finish those days");
        onClose();
      }
    });
  }

  if (done !== null) {
    return (
      <Modal title="Days finished" onClose={onClose} width={440}>
        <p style={{ fontSize: 13.5, lineHeight: 1.55, margin: 0 }}>
          {done} {page} shift{done === 1 ? "" : "s"} up to {formatDateDisplay(through)} {done === 1 ? "is" : "are"} saved and locked. A day's report
          is saved once both pages of it are finished.
        </p>
        <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 20 }}>
          <Button variant="primary" onClick={onClose}>
            Close
          </Button>
        </div>
      </Modal>
    );
  }

  return (
    <Modal title={`Finish ${page} through a date`} onClose={action.busy ? () => {} : onClose} width={520}>
      <div style={{ fontSize: 13.5, lineHeight: 1.55 }}>
        <p style={{ margin: "0 0 12px" }}>
          Finishes every unfinished {page} shift up to and including the date you pick, oldest first, in one go. If anything can't be finished, nothing is. The{" "}
          {PAGE_LABEL[location === "ONLINE" ? "OFFLINE" : "ONLINE"]} page is not affected.
        </p>
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 12 }}>
          <span style={{ fontWeight: 600 }}>Through</span>
          <DatePicker value={through} onChange={setThrough} todayValue={getCurrentShiftAndDate().date} aria-label="Finish through date" />
        </div>

        {loadError ? (
          <p role="alert" style={{ color: colors.danger, margin: 0 }}>
            {loadError}
          </p>
        ) : !ready ? (
          <p style={{ color: colors.subtleInk, margin: 0 }}>Checking…</p>
        ) : (
          <>
            {ready.blockers.length > 0 && (
              <ul role="alert" aria-label="Problems" style={{ margin: "0 0 10px", paddingLeft: 18, color: colors.danger }}>
                {ready.blockers.map((b) => (
                  <li key={b}>{b}</li>
                ))}
              </ul>
            )}

            {ready.periods.length === 0 ? (
              <p style={{ margin: 0, color: colors.subtleInk }}>Nothing to finish: every {page} shift up to that date is already finished.</p>
            ) : (
              <>
                <p style={{ margin: "0 0 6px", fontWeight: 600 }}>
                  {ready.periods.length} shift{ready.periods.length === 1 ? "" : "s"} will be locked
                </p>
                <ul
                  aria-label="Shifts to finish"
                  style={{ margin: "0 0 10px", paddingLeft: 18, maxHeight: 150, overflowY: "auto", color: colors.subtleInk }}
                >
                  {ready.periods.map((p) => (
                    <li key={`${p.entryDate}:${p.shift}`}>
                      {formatDateDisplay(p.entryDate)} · {SHIFT_LABELS[p.shift]} · {p.saved} product{p.saved === 1 ? "" : "s"} saved
                    </li>
                  ))}
                </ul>
              </>
            )}

            {needsAck && (
              <div style={{ marginBottom: 10 }}>
                <ul aria-label="Warnings" style={{ margin: "0 0 8px", paddingLeft: 18, color: colors.warningText }}>
                  {ready.warnings.map((w) => (
                    <li key={w}>{w}</li>
                  ))}
                </ul>
                {ready.canFinish && (
                  <label style={{ display: "flex", gap: 8, alignItems: "flex-start", cursor: "pointer" }}>
                    <input type="checkbox" checked={acknowledged} onChange={(e) => setAcknowledged(e.target.checked)} style={{ marginTop: 3 }} />
                    <span>I've looked at these and want to finish anyway.</span>
                  </label>
                )}
              </div>
            )}
          </>
        )}
      </div>
      <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 18 }}>
        <Button variant="secondary" onClick={onClose} disabled={action.busy} autoFocus>
          Cancel
        </Button>
        <Button variant="primary" onClick={() => void confirm()} disabled={!canConfirm} loading={action.busy} loadingLabel="Finishing…">
          {ready && ready.periods.length > 0 ? `Finish ${ready.periods.length} shift${ready.periods.length === 1 ? "" : "s"}` : "Finish"}
        </Button>
      </div>
    </Modal>
  );
}
