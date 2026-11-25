import { useEffect, useRef, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { verifyRecoveryEmail } from "../api/auth";
import { AuthCard, AuthShell } from "../components/AuthShell";
import { Button } from "../components/ui";
import { useAuth } from "../context/AuthContext";
import { colors } from "../theme";

type State = { kind: "working" } | { kind: "done" } | { kind: "error"; message: string };

/// The page the recovery-email confirmation link opens. Public: the mailbox is the proof, so it works
/// signed out or in another browser. The token is single-use, so it is sent exactly once (the ref
/// guards React StrictMode's double effect) and is removed from the address bar straight away.
export function VerifyEmailPage() {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const { user, refreshUser } = useAuth();
  const [state, setState] = useState<State>({ kind: "working" });
  const started = useRef(false);

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    // The app uses a HashRouter, so the token lives in the router's own query (`/#/verify-email?token=`),
    // not in window.location.search. It is dropped from the address bar straight away.
    const token = params.get("token") ?? "";
    navigate("/verify-email", { replace: true });
    if (!token) {
      setState({ kind: "error", message: "This link is incomplete. Request a new one from Account Settings." });
      return;
    }
    verifyRecoveryEmail(token)
      .then(() => {
        setState({ kind: "done" });
        if (user) void refreshUser().catch(() => {});
      })
      .catch((err) => setState({ kind: "error", message: err instanceof Error ? err.message : "Couldn't confirm the email. Try again." }));
    // Runs once on purpose: the token cannot be spent twice.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <AuthShell>
      <AuthCard maxWidth={360}>
        <h2 style={{ margin: "0 0 8px", fontSize: "calc(17px * var(--ae-fs, 1))" }}>Recovery email</h2>
        {state.kind === "working" && <p style={{ margin: 0, color: colors.subtleInk }}>Confirming your email…</p>}
        {state.kind === "done" && (
          <p role="status" style={{ margin: 0 }}>
            Your recovery email is confirmed. You can close this tab.
          </p>
        )}
        {state.kind === "error" && (
          <p role="alert" style={{ margin: 0, color: colors.danger }}>
            {state.message}
          </p>
        )}
        <div style={{ textAlign: "center", marginTop: 16 }}>
          <Button type="button" variant="secondary" size="sm" onClick={() => navigate(user ? "/" : "/login")}>
            {user ? "Back to the app" : "Go to sign in"}
          </Button>
        </div>
      </AuthCard>
    </AuthShell>
  );
}
