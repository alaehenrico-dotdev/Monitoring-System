import { useState } from "react";
import { reopenSubmissions, type AdminSubmission } from "../api/countSubmissions";
import type { Shift } from "../types";
import { formatClock } from "../utils/dateFormat";
import { useBusyAction } from "../hooks/useBusyAction";
import { Button } from "./ui";
import { Modal } from "./Modal";
import "../styles/auditor-review.css";

/**
 * What the auditors have sent for this sheet, on the admin's Audit page: who is counting, who has
 * submitted and how much. Clicking a submitted auditor fills the table with that auditor's counts as
 * ordinary unsaved counts, to be checked, saved and published like any other; "Reopen..." sends a
 * submitted count back, for whichever auditors the admin picks.
 */
export function AuditorReviewPanel({
  submissions,
  date,
  shift,
  stageCountOf,
  onUseCounts,
  onReopened,
  onError,
}: {
  submissions: AdminSubmission[];
  date: string;
  shift: Shift;
  /// How many of this auditor's figures are not in the table yet (what clicking them would stage).
  stageCountOf: (submission: AdminSubmission) => number;
  onUseCounts: (submission: AdminSubmission) => void;
  onReopened: (reopened: number) => void;
  onError: (message: string) => void;
}) {
  const [reopenOpen, setReopenOpen] = useState(false);
  const [chosen, setChosen] = useState<Set<number>>(new Set());
  const [reason, setReason] = useState("");
  const reopening = useBusyAction();

  if (submissions.length === 0) return null;
  const submitted = submissions.filter((s) => s.status === "SUBMITTED");

  function openReopen() {
    // Everyone who has submitted starts ticked; the admin unticks who should keep their count.
    setChosen(new Set(submitted.map((s) => s.auditor.id)));
    setReason("");
    setReopenOpen(true);
  }

  async function confirmReopen() {
    try {
      const result = await reopening.run(() => reopenSubmissions(date, shift, [...chosen], reason));
      setReopenOpen(false);
      if (result) onReopened(result.reopened);
    } catch (e) {
      setReopenOpen(false);
      onError(e instanceof Error ? e.message : "Could not reopen the count");
    }
  }

  return (
    <section className="ae-rv-panel no-print" aria-label="Auditor counts">
      <ul className="ae-rv-list">
        {submissions.map((s) => {
          const sent = s.status === "SUBMITTED";
          const todo = sent ? stageCountOf(s) : 0;
          const body = (
            <>
              <strong>{s.auditor.name}</strong>
              {sent ? (
                <span className="ae-rv-tag ae-rv-tag--sent">Submitted{s.submittedAt ? ` ${formatClock(Date.parse(s.submittedAt))}` : ""}</span>
              ) : (
                <span className="ae-rv-tag">{s.reopenedAt ? "Reopened - recounting" : "Counting…"}</span>
              )}
              <span className="ae-rv-counts">
                Online {s.counted.ONLINE} · Offline {s.counted.OFFLINE}
              </span>
              {sent && <span className="ae-rv-use">{todo > 0 ? `Use these counts (${todo})` : "✓ In the table"}</span>}
            </>
          );
          return (
            <li key={s.id}>
              {sent ? (
                <button
                  type="button"
                  className="ae-rv-who ae-rv-who--btn"
                  disabled={todo === 0}
                  aria-label={todo > 0 ? `Use ${s.auditor.name}'s counts (${todo})` : `${s.auditor.name}'s counts are already in the table`}
                  title={todo > 0 ? "Fill the table with this auditor's counts as unsaved counts - nothing is saved until you Save" : "Everything this auditor counted is already in the table"}
                  onClick={() => onUseCounts(s)}
                >
                  {body}
                </button>
              ) : (
                <div className="ae-rv-who">{body}</div>
              )}
            </li>
          );
        })}
      </ul>
      <div className="ae-rv-actions">
        <Button type="button" size="sm" variant="secondary" disabled={submitted.length === 0} title={submitted.length === 0 ? "Nothing is submitted yet" : "Send a submitted count back for a recount"} onClick={openReopen}>
          Reopen…
        </Button>
      </div>

      {reopenOpen && (
        <Modal title="Send back for a recount" width={420} onClose={() => setReopenOpen(false)}>
          <form
            style={{ display: "grid", gap: 12 }}
            onSubmit={(e) => {
              e.preventDefault();
              if (chosen.size > 0) void confirmReopen();
            }}
          >
            <fieldset className="ae-rv-choose">
              <legend>Who recounts?</legend>
              {submitted.map((s) => (
                <label key={s.id}>
                  <input
                    type="checkbox"
                    checked={chosen.has(s.auditor.id)}
                    onChange={(e) =>
                      setChosen((prev) => {
                        const next = new Set(prev);
                        if (e.target.checked) next.add(s.auditor.id);
                        else next.delete(s.auditor.id);
                        return next;
                      })
                    }
                  />
                  <span>
                    {s.auditor.name}
                    <span className="ae-rv-counts">
                      {" "}
                      Online {s.counted.ONLINE} · Offline {s.counted.OFFLINE}
                    </span>
                  </span>
                </label>
              ))}
            </fieldset>
            <label className="ae-rv-reason">
              <span>Note for them (optional)</span>
              <textarea className="ae-input" maxLength={500} placeholder="Recount aisle 3 and the cold room…" value={reason} onChange={(e) => setReason(e.target.value)} />
            </label>
            <p className="ae-rv-explain">Their numbers stay as they are; they can change them and submit again. Anyone you leave unticked keeps their submitted count.</p>
            <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
              <Button type="button" variant="secondary" onClick={() => setReopenOpen(false)}>
                Cancel
              </Button>
              <Button type="submit" disabled={chosen.size === 0} loading={reopening.busy} loadingLabel="Reopening…">
                Reopen {chosen.size > 0 ? chosen.size : ""}
              </Button>
            </div>
          </form>
        </Modal>
      )}
    </section>
  );
}
