import { useState, type FormEvent } from "react";
import { useAuth } from "../context/AuthContext";
import { Button, Field, TextInput } from "./ui";
import { showToast } from "./Toast";
import { colors } from "../theme";

export const PASSWORD_MIN_LENGTH = 10;
export const PASSWORD_MAX_LENGTH = 72;

const note = { margin: 0, fontSize: "calc(12.5px * var(--ae-fs, 1))" } as const;

/// The signed-in user changes their OWN password. Laid out like the admin's Set password
/// dialog (stacked fields, one full-width button). The server holds the real rules (length,
/// common-password list, not containing the username) and says which one failed; the form
/// only checks what can be checked without it, so the two never disagree.
export function ChangePasswordForm({ onDone }: { onDone?: () => void }) {
  const { changeOwnPassword } = useAuth();
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const tooShort = next.length > 0 && next.length < PASSWORD_MIN_LENGTH;
  const mismatch = confirm.length > 0 && next !== confirm;
  const canSubmit = current.length > 0 && next.length >= PASSWORD_MIN_LENGTH && next === confirm && !saving;

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!canSubmit) return;
    setError(null);
    setSaving(true);
    try {
      await changeOwnPassword(current, next);
      showToast("Password changed. Your other devices were signed out.", "success");
      onDone?.();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't change the password. Try again.");
      setSaving(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} style={{ display: "grid", gap: 14 }} autoComplete="off">
      <Field label="Current password">
        <TextInput
          type="password"
          autoComplete="current-password"
          autoFocus
          value={current}
          maxLength={PASSWORD_MAX_LENGTH}
          onChange={(e) => setCurrent(e.target.value)}
          style={{ width: "100%" }}
        />
      </Field>
      <div>
        <Field label="New password">
          <TextInput
            type="password"
            autoComplete="new-password"
            value={next}
            maxLength={PASSWORD_MAX_LENGTH}
            onChange={(e) => setNext(e.target.value)}
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
          autoComplete="new-password"
          value={confirm}
          maxLength={PASSWORD_MAX_LENGTH}
          onChange={(e) => setConfirm(e.target.value)}
          style={{ width: "100%" }}
        />
      </Field>
      {(mismatch || error) && (
        <p role="alert" style={{ ...note, color: colors.danger }}>
          {error ?? "Passwords don't match."}
        </p>
      )}
      <Button type="submit" disabled={!canSubmit}>
        {saving ? "Saving…" : "Change password"}
      </Button>
    </form>
  );
}
