import { useState, type FormEvent } from "react";
import { Navigate, useNavigate } from "react-router-dom";
import { resetPasswordWithCode } from "../api/auth";
import { AuthCard, AuthShell } from "../components/AuthShell";
import { PASSWORD_MAX_LENGTH, PASSWORD_MIN_LENGTH } from "../components/ChangePasswordForm";
import { showToast } from "../components/Toast";
import { Button, Field, TextInput } from "../components/ui";
import { useAuth } from "../context/AuthContext";
import { colors } from "../theme";

const note = { margin: 0, fontSize: "calc(12.5px * var(--ae-fs, 1))", lineHeight: 1.5 } as const;

/// Forgot password, for someone who cannot sign in. There is no email in this system. Either an
/// administrator issues a one-time code (Settings > User Passwords > Reset code) and hands it
/// over (it works once and expires after 30 minutes), or an Encoder with two-step verification
/// uses a current authenticator code or a recovery code. Reachable without signing in.
export function ForgotPasswordPage() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [username, setUsername] = useState("");
  const [code, setCode] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (user) return <Navigate to="/" replace />;

  const tooShort = next.length > 0 && next.length < PASSWORD_MIN_LENGTH;
  const mismatch = confirm.length > 0 && next !== confirm;
  const canSubmit = username.trim() !== "" && code.trim() !== "" && next.length >= PASSWORD_MIN_LENGTH && next === confirm && !saving;

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!canSubmit) return;
    setError(null);
    setSaving(true);
    try {
      await resetPasswordWithCode(username.trim(), code, next);
      showToast("Password changed. Sign in with your new password.", "success");
      navigate("/login", { replace: true });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't reset the password. Try again.");
      setSaving(false);
    }
  }

  return (
    <AuthShell>
      <AuthCard onSubmit={handleSubmit} maxWidth={360}>
        <h2 style={{ margin: "0 0 4px", fontSize: "calc(17px * var(--ae-fs, 1))" }}>Forgot your password?</h2>
        <p style={{ ...note, margin: "0 0 16px", color: colors.subtleInk }}>
          Ask your administrator for a reset code. It works once and expires after 30 minutes. Then enter it here with your username and a new password.
        </p>
        <p style={{ ...note, margin: "-8px 0 16px", color: colors.subtleInk }}>
          If two-step verification is on for your account, you can use the 6-digit code from your authenticator app (or a recovery code) instead.
        </p>
        <div style={{ display: "grid", gap: 12 }}>
          <Field label="Username">
            <TextInput value={username} onChange={(e) => setUsername(e.target.value)} autoComplete="username" autoFocus style={{ width: "100%" }} />
          </Field>
          <Field label="Reset code or authenticator code">
            <TextInput
              value={code}
              onChange={(e) => setCode(e.target.value)}
              autoComplete="off"
              autoCapitalize="characters"
              spellCheck={false}
              placeholder="XXXXX-XXXXX or 123456"
              style={{ width: "100%" }}
            />
          </Field>
          <div>
            <Field label="New password">
              <TextInput
                type="password"
                value={next}
                maxLength={PASSWORD_MAX_LENGTH}
                onChange={(e) => setNext(e.target.value)}
                autoComplete="new-password"
                style={{ width: "100%" }}
              />
            </Field>
            <p style={{ ...note, marginTop: 4, color: tooShort ? colors.danger : colors.subtleInk }}>
              At least {PASSWORD_MIN_LENGTH} characters. A few ordinary words strung together work well; avoid common passwords and your username.
            </p>
          </div>
          <Field label="Confirm new password">
            <TextInput
              type="password"
              value={confirm}
              maxLength={PASSWORD_MAX_LENGTH}
              onChange={(e) => setConfirm(e.target.value)}
              autoComplete="new-password"
              style={{ width: "100%" }}
            />
          </Field>
          {(mismatch || error) && (
            <p role="alert" style={{ ...note, color: colors.danger }}>
              {error ?? "Passwords don't match."}
            </p>
          )}
          <Button type="submit" disabled={!canSubmit} loading={saving} loadingLabel="Saving…" style={{ width: "100%", padding: 10 }}>
            Set new password
          </Button>
        </div>
        <div style={{ textAlign: "center", marginTop: 8 }}>
          <button type="button" className="ae-link-btn" onClick={() => navigate("/login")}>
            Back to sign in
          </button>
        </div>
      </AuthCard>
    </AuthShell>
  );
}
