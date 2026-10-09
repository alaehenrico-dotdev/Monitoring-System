import { useState, type FormEvent } from "react";
import { Modal } from "./Modal";
import { Button, Field, TextInput } from "./ui";
import { useAuth } from "../context/AuthContext";
import { ApiError } from "../api/http";
import { countAllUnsavedWork } from "../utils/unsavedWork";
import { colors } from "../theme";

/**
 * Shown over the current page when the session has expired while there is
 * unsaved work. Signing back in dismisses it and the page carries on exactly
 * where it was - the staged edits never left the screen. (Without this the
 * 401 logged the person out, the grids unmounted, and the edits only
 * survived in sessionStorage.)
 *
 * Can't be dismissed by Escape or a click outside: there is nothing to go
 * back to until the session is valid again. "Log out" is the way out, and it
 * keeps the edits for this user's next sign-in.
 */
export function SessionExpiredDialog() {
  const { user, reauthenticate, logoutKeepingDrafts } = useAuth();
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!password || busy) return;
    setBusy(true);
    setError(null);
    try {
      await reauthenticate(password);
    } catch (err) {
      setPassword("");
      setError(
        err instanceof ApiError && err.status === 401
          ? "That password isn't right."
          : err instanceof Error
            ? err.message
            : "Couldn't sign in. Check your connection and try again.",
      );
      setBusy(false);
    }
  }

  const staged = countAllUnsavedWork();

  return (
    <Modal title="Session expired" onClose={() => {}} width={400}>
      <form onSubmit={handleSubmit}>
        <p style={{ margin: "0 0 12px", fontSize: 13.5, lineHeight: 1.55 }}>
          Your session expired.{" "}
          {staged > 0
            ? `Your ${staged} unsaved change${staged === 1 ? "" : "s"} ${staged === 1 ? "is" : "are"} still here - `
            : ""}
          Sign back in as <strong>{user?.name ?? user?.username}</strong> to
          keep working, then save again.
        </p>
        <Field label="Password" style={{ marginBottom: 12 }}>
          <TextInput
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            style={{ width: "100%" }}
            autoFocus
            autoComplete="current-password"
          />
        </Field>
        {error && (
          <div
            role="alert"
            style={{ color: colors.danger, fontSize: 12.5, marginBottom: 12 }}
          >
            {error}
          </div>
        )}
        <div
          style={{
            display: "flex",
            justifyContent: "flex-end",
            gap: 8,
            marginTop: 8,
          }}
        >
          <Button
            type="button"
            variant="secondary"
            onClick={logoutKeepingDrafts}
            disabled={busy}
          >
            Log out
          </Button>
          <Button type="submit" variant="primary" disabled={busy || !password}>
            {busy ? "Signing in…" : "Sign in"}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
