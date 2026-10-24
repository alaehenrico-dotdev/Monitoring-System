import { useCallback, useEffect, useState, type CSSProperties } from "react";
import {
  closeMonth,
  getMonthReadiness,
  listMonthClosures,
  unlockMonth,
  type MonthClosure,
  type MonthReadiness,
} from "../api/ops";
import { Button } from "../components/ui";
import { ConfirmDialog } from "../components/ConfirmDialog";
import { Modal } from "../components/Modal";
import { Toast } from "../components/Toast";
import { InlineLoading } from "../components/Spinner";
import { getCurrentShiftAndDate } from "../utils/shift";
import { previousMonth, yearMonthOf } from "../utils/dateMath";
import { colors } from "../theme";

const rowStyle: CSSProperties = {
  display: "flex",
  alignItems: "center",
  flexWrap: "wrap",
  gap: 12,
  padding: "10px 16px",
  borderBottom: `1px solid ${colors.border}`,
  fontSize: "calc(13px * var(--ae-fs, 1))",
  color: colors.ink,
};

function errorMessage(e: unknown, fallback: string): string {
  return e instanceof Error ? e.message : fallback;
}

/**
 * Month close: the lock layer above a day's own. An admin closes a month once it
 * has ended and every day in it is finished, every count published and nothing
 * is still waiting on a correction. A closed month refuses every entry and count
 * dated in it - the one recorded way in is an approved correction - and no
 * carry-forward rewrites into it quietly. Unlocking needs a reason.
 */
export function MonthCloseTab() {
  // The month just ended is the one that is normally being closed.
  const [month, setMonth] = useState(() => previousMonth(yearMonthOf(getCurrentShiftAndDate().date)));
  const [closures, setClosures] = useState<MonthClosure[] | null>(null);
  const [readiness, setReadiness] = useState<{ month: string; value: MonthReadiness } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [unlocking, setUnlocking] = useState(false);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [version, setVersion] = useState(0);
  const refresh = useCallback(() => setVersion((v) => v + 1), []);

  useEffect(() => {
    let cancelled = false;
    listMonthClosures()
      .then((rows) => !cancelled && setClosures(rows))
      .catch((e) => !cancelled && setError(errorMessage(e, "Could not load closed months.")));
    return () => {
      cancelled = true;
    };
  }, [version]);

  useEffect(() => {
    let cancelled = false;
    getMonthReadiness(month)
      .then((value) => !cancelled && setReadiness({ month, value }))
      .catch((e) => !cancelled && setError(errorMessage(e, "Could not check that month.")));
    return () => {
      cancelled = true;
    };
  }, [month, version]);

  const closure = closures?.find((c) => c.yearMonth === month && c.isClosed) ?? null;
  // A readiness for another month must never be applied to this one.
  const r = readiness?.month === month ? readiness.value : null;

  async function act(fn: () => Promise<unknown>, success: string): Promise<boolean> {
    if (busy) return false;
    setBusy(true);
    setError(null);
    try {
      await fn();
      setNotice(success);
      refresh();
      return true;
    } catch (e) {
      setError(errorMessage(e, "That did not work."));
      return false;
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <p style={{ fontSize: "calc(13px * var(--ae-fs, 1))", color: colors.subtleInk, marginTop: 0 }}>
        A month can be closed once it has ended and every day in it is finished, its counts are published and no correction is waiting. A closed month refuses
        every edit dated in it; a change then needs an unlock (with a reason) or an approved correction.
      </p>
      <label style={{ fontSize: "calc(12px * var(--ae-fs, 1))", fontWeight: 600, color: colors.subtleInk, display: "block", marginBottom: 4 }}>
        Month
        <input
          type="month"
          className="ae-input"
          value={month}
          onChange={(e) => e.target.value && setMonth(e.target.value)}
          style={{ marginLeft: 8 }}
          aria-label="Month"
        />
      </label>

      <div className="ae-panel" style={{ marginTop: 12 }}>
        <div style={{ ...rowStyle, alignItems: "flex-start" }}>
          <span style={{ width: 80, fontWeight: 600 }}>{month}</span>
          <span style={{ flex: 1, minWidth: 0 }}>
            {closure ? (
              <>
                <span className="ae-dash-chip ae-dash-chip--done">Closed</span>
                <span style={{ marginLeft: 8, color: colors.subtleInk, fontSize: "calc(12.5px * var(--ae-fs, 1))" }}>
                  {new Date(closure.closedAt).toLocaleString()}
                  {closure.closedBy ? ` by ${closure.closedBy.name}` : ""}
                </span>
              </>
            ) : !r ? (
              <InlineLoading label="Checking…" />
            ) : r.ready ? (
              <span className="ae-dash-chip ae-dash-chip--progress">Ready to close</span>
            ) : (
              <span className="ae-dash-chip ae-dash-chip--idle">Not ready</span>
            )}
            {!closure && r && r.problems.length > 0 && (
              <ul aria-label="Problems" style={{ margin: "6px 0 0", paddingLeft: 18, color: colors.danger, fontSize: "calc(12.5px * var(--ae-fs, 1))" }}>
                {r.problems.map((p) => (
                  <li key={p}>{p}</li>
                ))}
              </ul>
            )}
            {!closure && r && r.warnings.length > 0 && (
              <ul aria-label="Warnings" style={{ margin: "6px 0 0", paddingLeft: 18, color: colors.warningText, fontSize: "calc(12.5px * var(--ae-fs, 1))" }}>
                {r.warnings.map((w) => (
                  <li key={w}>{w}</li>
                ))}
              </ul>
            )}
          </span>
          {closure ? (
            <Button
              className="ae-btn-solid"
              size="sm"
              disabled={busy}
              onClick={() => {
                setReason("");
                setUnlocking(true);
              }}
            >
              Unlock…
            </Button>
          ) : (
            <Button className="ae-btn-solid" size="sm" disabled={busy || !r?.ready} onClick={() => setConfirming(true)}>
              Close month
            </Button>
          )}
        </div>
      </div>

      <h3 style={{ fontSize: "calc(14px * var(--ae-fs, 1))", margin: "20px 0 8px" }}>Months</h3>
      {!closures ? (
        <InlineLoading label="Loading…" />
      ) : closures.length === 0 ? (
        <p style={{ color: colors.subtleInk, fontSize: "calc(13px * var(--ae-fs, 1))" }}>No month has been closed yet.</p>
      ) : (
        <div className="ae-panel">
          {closures.map((c) => (
            <div key={c.id} style={rowStyle}>
              <span style={{ width: 90 }}>{c.yearMonth}</span>
              <span style={{ flex: 1, minWidth: 0, color: colors.subtleInk, fontSize: "calc(12.5px * var(--ae-fs, 1))" }}>
                {c.isClosed
                  ? `Closed ${new Date(c.closedAt).toLocaleString()}${c.closedBy ? ` by ${c.closedBy.name}` : ""}`
                  : `Unlocked ${c.unlockedAt ? new Date(c.unlockedAt).toLocaleString() : ""}${c.unlockedBy ? ` by ${c.unlockedBy.name}` : ""}${c.unlockReason ? ` - ${c.unlockReason}` : ""}`}
              </span>
              <span className={`ae-dash-chip ae-dash-chip--${c.isClosed ? "done" : "idle"}`}>{c.isClosed ? "Closed" : "Open"}</span>
            </div>
          ))}
        </div>
      )}

      {confirming && (
        <ConfirmDialog
          title={`Close ${month}?`}
          confirmLabel="Close month"
          busy={busy}
          onConfirm={() => void act(() => closeMonth(month), `${month} is closed.`).then((ok) => ok && setConfirming(false))}
          onCancel={() => setConfirming(false)}
        >
          <p style={{ margin: "0 0 10px" }}>
            Every entry and count dated in {month} will be refused from now on. Only an approved correction, or unlocking the month with a reason, can change it
            again.
          </p>
          {r && r.warnings.length > 0 && <p style={{ margin: 0, color: colors.warningText }}>The warnings above will not stop the close - make sure they are expected.</p>}
        </ConfirmDialog>
      )}

      {unlocking && (
        <Modal title={`Unlock ${month}`} onClose={busy ? () => {} : () => setUnlocking(false)} width={440}>
          <textarea
            className="ae-input"
            aria-label="Reason for unlocking"
            rows={3}
            maxLength={500}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="Why does this month need to change?"
            style={{ width: "100%", boxSizing: "border-box", height: "auto", padding: 8 }}
          />
          <div style={{ display: "flex", gap: 10, justifyContent: "flex-end", marginTop: 14 }}>
            <Button className="ae-btn-solid" disabled={busy} onClick={() => setUnlocking(false)}>
              Cancel
            </Button>
            <Button
              className="ae-btn-solid"
              disabled={reason.trim().length < 5}
              loading={busy}
              loadingLabel="Unlocking…"
              onClick={() => void act(() => unlockMonth(month, reason.trim()), `${month} is unlocked.`).then((ok) => ok && setUnlocking(false))}
            >
              Unlock
            </Button>
          </div>
        </Modal>
      )}

      <Toast message={notice} onDismiss={() => setNotice(null)} variant="success" duration={6000} />
      <Toast message={error} onDismiss={() => setError(null)} variant="error" duration={null} />
    </>
  );
}
