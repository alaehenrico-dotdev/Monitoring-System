import { useState, type FormEvent } from "react";
import { Navigate, useNavigate } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import { ApiError } from "../api/http";
import { AuthCard, AuthShell } from "../components/AuthShell";
import { LoadingOverlay } from "../components/Spinner";
import { Button, Field, TextInput } from "../components/ui";
import { forgetDevice, isDeviceRemembered, rememberedUsername } from "../utils/rememberDevice";

export function LoginPage() {
  const { user, login, completeMfa, sessionError, clearSessionError } = useAuth();
  const navigate = useNavigate();
  const [username, setUsername] = useState(rememberedUsername);
  // Ticked by default on a device that was remembered before; unticked on a new one.
  const [remember, setRemember] = useState(isDeviceRemembered);
  const [password, setPassword] = useState("");
  // Set once the password was right but the account also needs a code from its authenticator.
  const [mfaToken, setMfaToken] = useState<string | null>(null);
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [capsLock, setCapsLock] = useState(false);

  if (user) return <Navigate to="/" replace />;

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    seen();
    setSubmitting(true);
    try {
      if (mfaToken) {
        await completeMfa(mfaToken, code);
        navigate("/");
        return;
      }
      const next = await login(username, password, remember);
      if (next) {
        setMfaToken(next.mfaToken);
        setPassword("");
        return;
      }
      navigate("/");
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Login failed");
      // The half-way sign-in only lasts a few minutes; once it has run out, start over.
      if (mfaToken && err instanceof ApiError && /expired/i.test(err.message)) {
        setMfaToken(null);
        setCode("");
      }
    } finally {
      setSubmitting(false);
    }
  }

  // The "session ended" notice is shown once: it goes as soon as the person starts typing or
  // submits, so it never lingers beside a fresh attempt or comes back on the next visit.
  const notice = error ? null : sessionError;
  const seen = () => {
    if (sessionError) clearSessionError();
  };

  return (
    <AuthShell>
      {submitting && <LoadingOverlay label="Signing in…" />}
      <AuthCard
        onSubmit={handleSubmit}
        title={mfaToken ? "Two-step verification" : "Sign in"}
        subtitle={mfaToken ? "Enter the 6-digit code from your authenticator app, or one of your recovery codes." : "Use your account to open the stock monitor."}
      >
        {mfaToken ? (
          <Field label="Verification code" style={{ marginBottom: 16 }}>
            <TextInput
              value={code}
              onChange={(e) => {
                seen();
                setCode(e.target.value);
              }}
              className="ae-auth-code"
              autoComplete="one-time-code"
              inputMode="numeric"
              autoFocus
            />
          </Field>
        ) : (
          <>
            <Field label="Username" style={{ marginBottom: 12 }}>
              <TextInput
                value={username}
                onChange={(e) => {
                  seen();
                  setUsername(e.target.value);
                }}
                style={{ width: "100%" }}
                autoComplete="username"
                autoFocus={!username}
              />
            </Field>

            <div style={{ marginBottom: 12 }}>
              <div className="ae-auth-label-row">
                <label htmlFor="login-password">Password</label>
                <button type="button" className="ae-link-btn" onClick={() => navigate("/forgot-password")}>
                  Forgot password?
                </button>
              </div>
              <div className="ae-auth-pw">
                <TextInput
                  id="login-password"
                  type={showPassword ? "text" : "password"}
                  value={password}
                  onChange={(e) => {
                    seen();
                    setPassword(e.target.value);
                  }}
                  onKeyDown={(e) => setCapsLock(e.getModifierState("CapsLock"))}
                  onKeyUp={(e) => setCapsLock(e.getModifierState("CapsLock"))}
                  onBlur={() => setCapsLock(false)}
                  style={{ width: "100%", boxSizing: "border-box" }}
                  autoComplete="current-password"
                  autoFocus={!!username}
                />
                <button
                  type="button"
                  className="ae-auth-pw-toggle"
                  aria-label={showPassword ? "Hide password" : "Show password"}
                  aria-pressed={showPassword}
                  onClick={() => setShowPassword((v) => !v)}
                >
                  {showPassword ? "Hide" : "Show"}
                </button>
              </div>
              {capsLock && (
                <p className="ae-auth-hint" role="status">
                  Caps Lock is on.
                </p>
              )}
            </div>

            <label className="ae-check" style={{ marginBottom: 16 }}>
              <input type="checkbox" checked={remember} onChange={(e) => setRemember(e.target.checked)} />
              <span>Remember this device</span>
            </label>
          </>
        )}

        {error && (
          <div role="alert" className="ae-auth-error">
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden>
              <circle cx="8" cy="8" r="7" stroke="currentColor" strokeWidth="1.5" />
              <path d="M8 4.5v4M8 10.8v.01" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
            </svg>
            <span>{error}</span>
          </div>
        )}
        {/* Not an error: an explanation of why the person landed here, after a session that
            was in use ended (expired, revoked). Shown once, then dismissed by seen(). */}
        {notice && (
          <div role="status" className="ae-auth-notice">
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden>
              <circle cx="8" cy="8" r="7" stroke="currentColor" strokeWidth="1.5" />
              <path d="M8 7.2v4M8 4.8v.01" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
            </svg>
            <span>{notice}</span>
          </div>
        )}

        <Button type="submit" disabled={submitting} style={{ width: "100%", padding: 10 }}>
          {submitting ? "Signing in…" : mfaToken ? "Verify" : "Sign in"}
        </Button>

        <div className="ae-auth-foot">
          {!mfaToken && isDeviceRemembered() && (
            <button
              type="button"
              className="ae-link-btn"
              onClick={() => {
                forgetDevice();
                setUsername("");
                setRemember(false);
              }}
            >
              Forget this device
            </button>
          )}
          {mfaToken && (
            <button
              type="button"
              className="ae-link-btn"
              onClick={() => {
                setMfaToken(null);
                setCode("");
                setError(null);
              }}
            >
              ← Use a different account
            </button>
          )}
        </div>
      </AuthCard>
    </AuthShell>
  );
}
