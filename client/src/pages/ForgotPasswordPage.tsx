import { useEffect, useState, type FormEvent } from "react";
import { Navigate, useNavigate, useSearchParams } from "react-router-dom";
import { requestResetEmail, resetPasswordWithCode } from "../api/auth";
import { AuthCard, AuthShell } from "../components/AuthShell";
import { PASSWORD_MAX_LENGTH, PASSWORD_MIN_LENGTH } from "../components/ChangePasswordForm";
import { showToast } from "../components/Toast";
import { Button, Field, TextInput } from "../components/ui";
import { useAuth } from "../context/AuthContext";
import { colors } from "../theme";

const note = { margin: 0, fontSize: "calc(12.5px * var(--ae-fs, 1))", lineHeight: 1.5 } as const;

/// Forgot password, for someone who cannot sign in. An administrator with a verified recovery email
/// can have a code emailed to them. Otherwise either an administrator issues a one-time code (Settings > User Passwords > Reset code) and hands it
/// over (it works once and expires after 30 minutes), or an Encoder with two-step verification
/// uses a current authenticator code or a recovery code. Reachable without signing in.
export function ForgotPasswordPage() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const [username, setUsername] = useState(() => (params.get("username") ?? "").slice(0, 64));
  // Arrived from the emailed link: the username is known, so the cursor belongs in the code box.
  const [prefilled] = useState(() => username.trim() !== "");
  // Seconds left before "Email me a code" can be used again (matches the server's one-a-minute limit).
  const [cooldown, setCooldown] = useState(0);
  const [emailing, setEmailing] = useState(false);
  const [emailNote, setEmailNote] = useState<string | null>(null);
  const [code, setCode] = useState("");
  const [next, setNext] = useState("");
  const [show, setShow] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (cooldown <= 0) return;
    const t = window.setTimeout(() => setCooldown((c) => c - 1), 1000);
    return () => window.clearTimeout(t);
  }, [cooldown]);

  if (user) return <Navigate to="/" replace />;

  async function handleEmailCode() {
    if (!username.trim() || emailing || cooldown > 0) return;
    setError(null);
    setEmailing(true);
    try {
      const res = await requestResetEmail(username.trim());
      setEmailNote(res.message);
      setCooldown(60);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't send the email. Try again.");
    } finally {
      setEmailing(false);
    }
  }

  const tooShort = next.length > 0 && next.length < PASSWORD_MIN_LENGTH;
  const canSubmit = username.trim() !== "" && code.trim() !== "" && next.length >= PASSWORD_MIN_LENGTH && !saving;

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
        <p style={{ ...note, margin: "0 0 16px", color: colors.subtleInk }}>Enter the code you were given, then choose a new password.</p>
        <div style={{ display: "grid", gap: 12 }}>
          <Field label="Username" htmlFor="fp-username">
            <TextInput
              id="fp-username"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              autoComplete="username"
              autoFocus={!prefilled}
              style={{ width: "100%" }}
            />
          </Field>
          <div>
            <Field
              label="Reset code"
              htmlFor="fp-code"
              action={
                <button type="button" className="ae-link-btn" onClick={handleEmailCode} disabled={!username.trim() || emailing || cooldown > 0}>
                  {emailing ? "Sending…" : cooldown > 0 ? `Email me a code (${cooldown}s)` : "Email me a code"}
                </button>
              }
            >
              <TextInput
                id="fp-code"
                value={code}
                onChange={(e) => setCode(e.target.value)}
                autoComplete="off"
                autoCapitalize="characters"
                spellCheck={false}
                autoFocus={prefilled}
                placeholder="XXXXX-XXXXX"
                style={{ width: "100%" }}
              />
            </Field>
            <p role={emailNote ? "status" : undefined} style={{ ...note, marginTop: 4, color: colors.subtleInk }}>
              {emailNote ? `${emailNote} Check your inbox and spam folder.` : "Works once and expires in 30 minutes. An authenticator or recovery code also works."}
            </p>
          </div>
          <div>
            <Field
              label="New password"
              htmlFor="fp-new"
              action={
                <button type="button" className="ae-link-btn" onClick={() => setShow((v) => !v)} aria-pressed={show}>
                  {show ? "Hide" : "Show"}
                </button>
              }
            >
              <TextInput
                id="fp-new"
                type={show ? "text" : "password"}
                value={next}
                maxLength={PASSWORD_MAX_LENGTH}
                onChange={(e) => setNext(e.target.value)}
                autoComplete="new-password"
                style={{ width: "100%" }}
              />
            </Field>
            <p style={{ ...note, marginTop: 4, color: tooShort ? colors.danger : colors.subtleInk }}>At least {PASSWORD_MIN_LENGTH} characters.</p>
          </div>
          {error && (
            <p role="alert" style={{ ...note, color: colors.danger }}>
              {error}
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
