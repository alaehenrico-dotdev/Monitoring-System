import { useEffect, useRef, useState, type FormEvent } from "react";
import { ApiError } from "../api/http";
import { resetAllData, verifyResetPasscode } from "../api/dataReset";
import { Button } from "../components/ui";
import { Modal } from "../components/Modal";
import { colors } from "../theme";
import { clearReportHistory } from "../utils/reportHistory";
import { clearAllPendingEntryState } from "../hooks/usePendingEntryChanges";
import { InlineLoading, Spinner } from "../components/Spinner";

const COUNTDOWN_SECONDS = 10;

type Status = "idle" | "confirming" | "resetting" | "done" | "error";
type LockStatus = "locked" | "verifying" | "unlocked";

// Fixed brand colors, not the light/dark theme tokens (--ae-*) - this panel
// is deliberately styled like the app's other "permanently dark" surfaces
// (sidebar, dashboard, login, table headers; see index.css) rather than
// following the page's own light/dark mode, so a destructive admin action
// reads as a distinct, serious zone of the UI regardless of theme.
const PANEL_BG = "#14110d";
const PANEL_BG_ALT = "#1d1812";
const PANEL_BORDER = "#3a3020";
const PANEL_TEXT = "#f1e9d0"; // cream/white
const PANEL_TEXT_MUTED = "#a89a7d";
const PANEL_GOLD = "#c99a2e";
const PANEL_RED = "#e2555c";

const WIPED_ITEMS = ["Online & offline stock entries", "Manual counts", "Receipts / sales orders", "Daily & variance reports", "Change log"];
const PRESERVED_ITEMS = ["Products & categories", "Delivery destinations", "User accounts & roles", "System settings"];

/// Section: Admin - lets a supervisor wipe all transactional data (entries,
/// counts, receipts, reports, change log) to hand the system a clean slate
/// for a new period or site, without needing a developer to touch the
/// database directly. Destructive and irreversible, so the page itself sits
/// behind a backend-verified passcode gate (nobody who merely navigates
/// here can even see the reset panel), and the reset action itself is
/// further gated behind an explicit confirmation plus a countdown the admin
/// can still back out of.
export function DataResetPage() {
  const [lockStatus, setLockStatus] = useState<LockStatus>("locked");
  const [passcode, setPasscode] = useState("");
  const [lockError, setLockError] = useState<string | null>(null);
  // Short-lived, server-issued proof that the passcode was verified - has to
  // be sent back with the actual reset call (see api/dataReset.ts), and
  // expires a few minutes after verifyResetPasscode issues it.
  const [resetToken, setResetToken] = useState<string | null>(null);

  const [status, setStatus] = useState<Status>("idle");
  const [secondsLeft, setSecondsLeft] = useState(COUNTDOWN_SECONDS);
  const [error, setError] = useState<string | null>(null);
  const firingRef = useRef(false);

  async function handleUnlock(e: FormEvent) {
    e.preventDefault();
    setLockError(null);
    setLockStatus("verifying");
    try {
      const token = await verifyResetPasscode(passcode);
      if (token) {
        setResetToken(token);
        setLockStatus("unlocked");
      } else {
        setLockError("Incorrect passcode.");
        setLockStatus("locked");
      }
    } catch (err) {
      setLockError(err instanceof Error ? err.message : "Couldn't verify passcode. Try again.");
      setLockStatus("locked");
    } finally {
      setPasscode("");
    }
  }

  function openConfirm() {
    setError(null);
    setSecondsLeft(COUNTDOWN_SECONDS);
    firingRef.current = false;
    setStatus("confirming");
  }

  function cancel() {
    setStatus("idle");
  }

  useEffect(() => {
    if (status !== "confirming" || secondsLeft <= 0) return;
    // Counts down only to gate when "Reset Now" becomes clickable - it never
    // fires the reset by itself. An irreversible whole-database wipe should
    // only ever happen from an admin's own explicit click, never because
    // they left the tab open and didn't come back in time.
    const timer = setTimeout(() => setSecondsLeft((s) => s - 1), 1000);
    return () => clearTimeout(timer);
  }, [status, secondsLeft]);

  async function performReset() {
    setStatus("resetting");
    try {
      if (!resetToken) throw new Error("Passcode session expired - unlock this page again.");
      await resetAllData(resetToken);
      // The Daily/Variance Report History pages list is browser-local
      // (localStorage, see utils/reportHistory.ts) - the server-side wipe
      // above can't touch it, but leaving old entries around after a reset
      // would let an admin reopen a "history" report that's now empty.
      clearReportHistory();
      // Same reasoning, for the Online/Offline Entry and Manual Count
      // pages' own staged-but-unsaved edits (sessionStorage, see
      // hooks/usePendingEntryChanges.ts) - without this, a pending edit from
      // before the reset could still get saved afterward against a baseline
      // that's now completely different (or gone).
      //
      // The CSV import Review modal (CsvTools.tsx) needs no equivalent
      // handling here: its parsed-but-unstaged rows live only in that
      // component's own React state, never sessionStorage, so they're
      // already gone on any remount/navigation - there's nothing left for a
      // reset to clean up.
      clearAllPendingEntryState();
      setStatus("done");
    } catch (err) {
      // The reset token is single-use-window (~5 min) - if it's expired or
      // was already spent, there's no point letting the admin just retry
      // with the same stale token, so drop back to the passcode screen.
      if (err instanceof ApiError && (err.status === 401 || err.status === 403)) {
        setResetToken(null);
        setLockStatus("locked");
      }
      setError(err instanceof Error ? err.message : "Failed to reset data.");
      setStatus("error");
    }
  }

  if (lockStatus !== "unlocked") {
    return (
      <div>
        <p style={{ fontSize: 13, color: colors.subtleInk, margin: "0 0 20px", maxWidth: 620 }}>
          This section is restricted. Enter the reset passcode to continue.
        </p>

        <div
          style={{
            maxWidth: 360,
            background: `linear-gradient(180deg, ${PANEL_BG_ALT}, ${PANEL_BG})`,
            border: `1px solid ${PANEL_BORDER}`,
            borderRadius: 4,
            padding: "32px 32px",
            boxShadow: "0 14px 34px rgba(20,17,13,0.28)",
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 18 }}>
            <span aria-hidden style={{ fontSize: 16, color: PANEL_GOLD }}>
              🔒
            </span>
            <span style={{ fontSize: 11.5, fontWeight: 700, letterSpacing: 2.5, color: PANEL_GOLD, textTransform: "uppercase" }}>
              Restricted
            </span>
          </div>

          <form onSubmit={handleUnlock}>
            <label style={{ display: "block", fontSize: 12.5, color: PANEL_TEXT_MUTED, marginBottom: 8 }} htmlFor="reset-passcode">
              Passcode
            </label>
            <input
              id="reset-passcode"
              type="password"
              inputMode="numeric"
              autoFocus
              value={passcode}
              onChange={(e) => setPasscode(e.target.value)}
              disabled={lockStatus === "verifying"}
              placeholder="••••••"
              style={{
                width: "100%",
                boxSizing: "border-box",
                fontFamily: "inherit",
                fontSize: 15,
                letterSpacing: 3,
                padding: "10px 12px",
                borderRadius: 4,
                border: `1px solid ${PANEL_BORDER}`,
                background: "rgba(255,255,255,0.05)",
                color: PANEL_TEXT,
                marginBottom: 14,
              }}
            />

            {lockError && (
              <p style={{ margin: "0 0 14px", fontSize: 12.5, color: PANEL_RED }}>{lockError}</p>
            )}

            <Button
              type="submit"
              variant="danger"
              disabled={lockStatus === "verifying" || !passcode}
              style={{ width: "100%", display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 8 }}
            >
              {lockStatus === "verifying" && <Spinner size="sm" color={PANEL_RED} />}
              {lockStatus === "verifying" ? "Verifying…" : "Unlock"}
            </Button>
          </form>
        </div>
      </div>
    );
  }

  return (
    <div>
      <p style={{ fontSize: 13, color: colors.subtleInk, margin: "0 0 20px", maxWidth: 760 }}>
        Use this to give the system a completely fresh start. This is meant for wiping test data or
        starting a brand-new inventory period, and it cannot be undone once it runs.
      </p>

      <div
        style={{
          maxWidth: 760,
          background: `linear-gradient(180deg, ${PANEL_BG_ALT}, ${PANEL_BG})`,
          border: `1px solid ${PANEL_BORDER}`,
          borderRadius: 4,
          padding: "36px 40px",
          boxShadow: "0 14px 34px rgba(20,17,13,0.28)",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 14 }}>
          <span
            aria-hidden
            style={{
              width: 8,
              height: 8,
              borderRadius: "50%",
              background: PANEL_RED,
              boxShadow: `0 0 0 3px color-mix(in srgb, ${PANEL_RED} 25%, transparent)`,
            }}
          />
          <span style={{ fontSize: 11.5, fontWeight: 700, letterSpacing: 2.5, color: PANEL_RED, textTransform: "uppercase" }}>
            Danger Zone
          </span>
        </div>

        <h3 style={{ margin: "0 0 10px", fontSize: 21, fontWeight: 700, color: PANEL_TEXT }}>Reset all transactional data</h3>
        <p style={{ margin: "0 0 28px", fontSize: 13.5, lineHeight: 1.6, color: PANEL_TEXT_MUTED, maxWidth: 560 }}>
          All stock data below will be permanently deleted and cannot be recovered. Make sure any
          reports you need have already been exported or printed before continuing.
        </p>

        <div
          style={{
            display: "grid",
            gridTemplateColumns: "1fr 1fr",
            gap: 28,
            padding: "22px 24px",
            background: "rgba(255,255,255,0.03)",
            border: `1px solid ${PANEL_BORDER}`,
            borderRadius: 3,
            marginBottom: 28,
          }}
        >
          <div>
            <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: 1.5, color: PANEL_RED, textTransform: "uppercase", marginBottom: 10 }}>
              Will be erased
            </div>
            <ul style={{ margin: 0, padding: 0, listStyle: "none", display: "flex", flexDirection: "column", gap: 7 }}>
              {WIPED_ITEMS.map((item) => (
                <li key={item} style={{ fontSize: 13, color: PANEL_TEXT, display: "flex", alignItems: "baseline", gap: 8 }}>
                  <span style={{ color: PANEL_RED, fontSize: 11 }}>✕</span>
                  {item}
                </li>
              ))}
            </ul>
          </div>
          <div>
            <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: 1.5, color: PANEL_GOLD, textTransform: "uppercase", marginBottom: 10 }}>
              Left untouched
            </div>
            <ul style={{ margin: 0, padding: 0, listStyle: "none", display: "flex", flexDirection: "column", gap: 7 }}>
              {PRESERVED_ITEMS.map((item) => (
                <li key={item} style={{ fontSize: 13, color: PANEL_TEXT, display: "flex", alignItems: "baseline", gap: 8 }}>
                  <span style={{ color: PANEL_GOLD, fontSize: 11 }}>✓</span>
                  {item}
                </li>
              ))}
            </ul>
          </div>
        </div>

        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 16, flexWrap: "wrap" }}>
          <Button variant="danger" onClick={openConfirm} disabled={status === "resetting"} style={{ padding: "10px 22px" }}>
            Reset Data
          </Button>

          {status === "done" && (
            <p style={{ margin: 0, fontSize: 12.5, color: PANEL_GOLD, fontWeight: 600 }}>
              All data has been reset. The system is now a clean slate.
            </p>
          )}
          {status === "error" && error && (
            <p style={{ margin: 0, fontSize: 12.5, color: PANEL_RED }}>{error}</p>
          )}
        </div>
      </div>

      {(status === "confirming" || status === "resetting") && (
        <Modal title="Confirm data reset" onClose={status === "confirming" ? cancel : () => {}} width={440}>
          {status === "confirming" ? (
            <>
              <p style={{ margin: "0 0 12px", fontSize: 13.5 }}>
                This will permanently delete <strong>all</strong> entries, counts, receipts, and
                reports. This cannot be undone.
              </p>
              <p style={{ margin: "0 0 18px", fontSize: 13 }}>
                {secondsLeft > 0 ? (
                  <>
                    "Reset Now" unlocks in{" "}
                    <strong style={{ color: colors.danger, fontSize: 16 }}>{secondsLeft}</strong>{" "}
                    second{secondsLeft === 1 ? "" : "s"}. Nothing happens until you click it.
                  </>
                ) : (
                  "You can now click “Reset Now” to proceed, or Cancel to back out."
                )}
              </p>
              <div style={{ display: "flex", gap: 10, justifyContent: "flex-end" }}>
                <Button variant="secondary" onClick={cancel}>
                  Cancel
                </Button>
                <Button
                  variant="danger"
                  disabled={secondsLeft > 0}
                  title={secondsLeft > 0 ? `Available in ${secondsLeft}s` : undefined}
                  onClick={() => {
                    if (!firingRef.current) {
                      firingRef.current = true;
                      void performReset();
                    }
                  }}
                >
                  Reset Now
                </Button>
              </div>
            </>
          ) : (
            <InlineLoading label="Resetting data…" />
          )}
        </Modal>
      )}
    </div>
  );
}