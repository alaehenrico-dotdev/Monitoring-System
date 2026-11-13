import { useState } from "react";
import { Outlet } from "react-router-dom";
import { verifyPassword } from "../api/auth";
import { useAuth } from "../context/AuthContext";
import { useReadOnlyPhone } from "../hooks/useReadOnlyPhone";

/// A touch screen showing the desktop layout: a phone using its browser's "Desktop site"
/// option (the page then gets a desktop-sized width, so the read-only phone view switches
/// off and editing opens up). Tablets match too, which is acceptable: it is one prompt a
/// session. `pointer: coarse` is the primary input, so a laptop with a touchscreen is not caught.
function isTouchInDesktopMode(): boolean {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function")
    return false;
  return (
    window.matchMedia("(pointer: coarse)").matches &&
    (navigator.maxTouchPoints ?? 0) > 0
  );
}

const unlockKey = (userId: number) => `ae:desktop-mode-ok:${userId}`;

function isUnlocked(userId: number): boolean {
  try {
    return sessionStorage.getItem(unlockKey(userId)) === "1";
  } catch {
    return false;
  }
}

/// Hardening for the phone -> desktop switch. The phone view is read-only; switching a
/// touch device to desktop mode unlocks every editing page, so it takes two deliberate
/// steps - an explicit confirmation, then the account password again - once per browser
/// tab session. A UI guard on top of, not instead of, the server's own permission checks.
export function DesktopModeGate() {
  const phone = useReadOnlyPhone();
  const { user, logout } = useAuth();
  const [unlocked, setUnlocked] = useState(() =>
    user ? isUnlocked(user.id) : false,
  );
  const [step, setStep] = useState<"confirm" | "password">("confirm");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (phone || !user || unlocked || !isTouchInDesktopMode()) return <Outlet />;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!user || busy || password === "") return;
    setBusy(true);
    setError(null);
    try {
      await verifyPassword(password);
      try {
        sessionStorage.setItem(unlockKey(user.id), "1");
      } catch {
        /* the prompt just comes back after a reload */
      }
      setUnlocked(true);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Could not verify the password.",
      );
      setPassword("");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div
      className="ae-dmg no-print"
      role="dialog"
      aria-modal="true"
      aria-labelledby="ae-dmg-title"
    >
      <div className="ae-dmg-card">
        <h2 id="ae-dmg-title">Switch to desktop mode?</h2>
        {step === "confirm" ? (
          <>
            <p>
              This phone is showing the desktop site. Desktop mode turns on{" "}
              <strong>editing</strong>: stock entries, counts, corrections and
              settings. The mobile view is read-only.
            </p>
            <p className="ae-dmg-hint">
              To stay read-only, turn off <em>Desktop site</em> in your browser
              menu.
            </p>
            <div className="ae-dmg-actions">
              <button
                type="button"
                className="ae-dmg-secondary"
                onClick={() => logout()}
              >
                Sign out
              </button>
              <button
                type="button"
                className="ae-dmg-primary"
                onClick={() => setStep("password")}
              >
                Continue to desktop mode
              </button>
            </div>
          </>
        ) : (
          <form onSubmit={submit}>
            <p>Enter your password to confirm it&rsquo;s you.</p>
            <input
              type="password"
              className="ae-dmg-input"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete="current-password"
              autoFocus
              aria-label="Password"
              aria-invalid={error ? true : undefined}
            />
            {error && (
              <p className="ae-dmg-error" role="alert">
                {error}
              </p>
            )}
            <div className="ae-dmg-actions">
              <button
                type="button"
                className="ae-dmg-secondary"
                onClick={() => {
                  setStep("confirm");
                  setError(null);
                  setPassword("");
                }}
              >
                Back
              </button>
              <button
                type="submit"
                className="ae-dmg-primary"
                disabled={busy || password === ""}
              >
                {busy ? "Checking…" : "Unlock desktop mode"}
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
