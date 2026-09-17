import { useState, type FormEvent } from "react";
import { Navigate, useNavigate } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import { ApiError } from "../api/http";
import { LogoMark } from "../components/LogoMark";
import { Button, Field, TextInput } from "../components/ui";
import { colors, fonts } from "../theme";

export function LoginPage() {
  const { user, login } = useAuth();
  const navigate = useNavigate();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  if (user) return <Navigate to="/" replace />;

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      await login(username, password);
      navigate("/");
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Login failed");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        minHeight: "100vh",
        fontFamily: fonts.body,
        background: colors.black,
        backgroundImage: `radial-gradient(circle at 50% -10%, ${colors.blackSoft}, ${colors.black} 70%)`,
      }}
    >
      <LogoMark size={104} />
      <h1 style={{ fontFamily: fonts.wordmark, fontSize: 26, fontWeight: 800, color: colors.yellow, margin: "12px 0 2px" }}>Ala Eh!</h1>
      <p style={{ fontSize: 12.5, color: colors.cream, opacity: 0.8, margin: "0 0 24px", letterSpacing: 0.4 }}>
        Online &amp; Offline Stocks Monitoring System
      </p>

      <form
        onSubmit={handleSubmit}
        style={{
          width: 320,
          background: colors.paper,
          borderRadius: 10,
          padding: 24,
          border: `1px solid ${colors.goldDark}`,
          boxShadow: "0 12px 32px rgba(0,0,0,0.35)",
        }}
      >
        <Field label="Username" style={{ marginBottom: 12 }}>
          <TextInput value={username} onChange={(e) => setUsername(e.target.value)} style={{ width: "100%" }} autoFocus />
        </Field>

        <Field label="Password" style={{ marginBottom: 16 }}>
          <TextInput type="password" value={password} onChange={(e) => setPassword(e.target.value)} style={{ width: "100%" }} />
        </Field>

        {error && <p style={{ color: colors.danger, fontSize: 13, marginTop: -8, marginBottom: 12 }}>{error}</p>}

        <Button type="submit" disabled={submitting} style={{ width: "100%", padding: 10 }}>
          {submitting ? "Signing in…" : "Sign in"}
        </Button>
      </form>
    </div>
  );
}
