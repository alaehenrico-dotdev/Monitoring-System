import { useState, type FormEvent } from "react";
import { Navigate, useNavigate } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import { ApiError } from "../api/http";
import { AuthCard, AuthShell } from "../components/AuthShell";
import { LoadingOverlay } from "../components/Spinner";
import { Button, Field, TextInput } from "../components/ui";
import { colors } from "../theme";
import { forgetDevice, isDeviceRemembered, rememberedUsername } from "../utils/rememberDevice";

const small = { fontSize: "calc(13px * var(--ae-fs, 1))", margin: 0 } as const;

export function LoginPage() {
  const { user, login, completeMfa, sessionError } = useAuth();
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

  if (user) return <Navigate to="/" replace />;

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
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

  return (
    <AuthShell>
      {submitting && <LoadingOverlay label="Signing in…" />}
      <AuthCard onSubmit={handleSubmit}>
        {mfaToken ? (
          <>
            <p style={{ ...small, margin: "0 0 12px", color: colors.subtleInk, lineHeight: 1.5 }}>
              Enter the 6-digit code from your authenticator app, or one of your recovery codes.
            </p>
            <Field label="Verification code" style={{ marginBottom: 16 }}>
              <TextInput
                value={code}
                onChange={(e) => setCode(e.target.value)}
                style={{ width: "100%" }}
                autoComplete="one-time-code"
                autoFocus
              />
            </Field>
          </>
        ) : (
          <>
            <Field label="Username" style={{ marginBottom: 12 }}>
              <TextInput
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                style={{ width: "100%" }}
                autoComplete="username"
                autoFocus={!username}
              />
            </Field>

            <Field label="Password" style={{ marginBottom: 12 }}>
              <TextInput
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                style={{ width: "100%" }}
                autoComplete="current-password"
                autoFocus={!!username}
              />
            </Field>

            <label className="ae-check" style={{ marginBottom: 16 }}>
              <input type="checkbox" checked={remember} onChange={(e) => setRemember(e.target.checked)} />
              <span>
                Remember this device
                <span className="ae-check-hint">Stays signed in here and remembers your username. Only on a device that is yours.</span>
              </span>
            </label>
          </>
        )}

        {/* A submit error takes precedence once the user has actually tried
            signing in; sessionError (the initial session check failing for a
            reason other than "not logged in") is what explains why they
            landed here in the first place, if that's what happened. */}
        {(error ?? sessionError) && (
          <p role="alert" style={{ ...small, color: colors.danger, marginBottom: 12 }}>
            {error ?? sessionError}
          </p>
        )}

        <Button type="submit" disabled={submitting} style={{ width: "100%", padding: 10 }}>
          {submitting ? "Signing in…" : mfaToken ? "Verify" : "Sign in"}
        </Button>

        {!mfaToken && (
          <div style={{ textAlign: "center", marginTop: 8 }}>
            <button type="button" className="ae-link-btn" onClick={() => navigate("/forgot-password")}>
              Forgot password?
            </button>
          </div>
        )}
        {!mfaToken && isDeviceRemembered() && (
          <div style={{ textAlign: "center", marginTop: 0 }}>
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
          </div>
        )}
        {mfaToken && (
          <div style={{ textAlign: "center", marginTop: 8 }}>
            <button
              type="button"
              className="ae-link-btn"
              onClick={() => {
                setMfaToken(null);
                setCode("");
                setError(null);
              }}
            >
              Use a different account
            </button>
          </div>
        )}
      </AuthCard>
    </AuthShell>
  );
}
