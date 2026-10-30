import { useEffect, useState, type FormEvent } from "react";
import {
  listAccounts,
  setAccountPassword,
  type AccountSummary,
} from "../api/users";
import { Button, Field, TextInput } from "../components/ui";
import { Modal } from "../components/Modal";
import { showToast } from "../components/Toast";
import { colors } from "../theme";
import { initials } from "../utils/initials";

const MIN_LENGTH = 10;

/// Admin-only (it lives on the Settings page, and the server requires
/// SUPERVISOR_ADMIN): the one place a password can be changed. Replaces the
/// generated password an account was handed out with.
export function UserPasswordsPage() {
  const [accounts, setAccounts] = useState<AccountSummary[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [target, setTarget] = useState<AccountSummary | null>(null);

  useEffect(() => {
    let cancelled = false;
    listAccounts()
      .then((a) => !cancelled && setAccounts(a))
      .catch(
        (e) =>
          !cancelled &&
          setLoadError(
            e instanceof Error ? e.message : "Couldn't load accounts.",
          ),
      );
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div style={{ width: "100%", maxWidth: 760, margin: "0 auto" }}>
      <p style={{ fontSize: "calc(13px * var(--ae-fs, 1))", color: colors.subtleInk, margin: "0 0 20px" }}>
        Pick an account and set a temporary password, then hand it to the user.
        They are asked to choose their own the next time they sign in. Users can
        also change their own under Settings &gt; My Account.
      </p>
      {loadError && (
        <p role="alert" style={{ color: colors.danger, fontSize: "calc(13px * var(--ae-fs, 1))" }}>
          {loadError}
        </p>
      )}
      {!accounts && !loadError && (
        <p style={{ fontSize: "calc(13px * var(--ae-fs, 1))", color: colors.subtleInk }}>Loading…</p>
      )}
      {accounts && (
        <div className="ae-account-list">
          {accounts.map((a) => (
            <div
              key={a.id}
              className={`ae-dash-card ae-account-card${a.isActive ? "" : " ae-account-card--inactive"}`}
            >
              <div className="ae-account-avatar" aria-hidden="true">
                {initials(a.name)}
              </div>
              <div className="ae-account-info">
                <div className="ae-account-name">{a.name}</div>
                <div className="ae-account-meta">
                  <span>{a.username}</span>
                  <span className="ae-account-role">
                    {a.role.replace(/_/g, " ")}
                  </span>
                  {!a.isActive && (
                    <span className="ae-account-role ae-account-role--off">
                      inactive
                    </span>
                  )}
                </div>
              </div>
              <Button
                variant="secondary"
                className="ae-btn-solid"
                size="sm"
                onClick={() => setTarget(a)}
              >
                Set password
              </Button>
            </div>
          ))}
        </div>
      )}
      {target && (
        <SetPasswordModal account={target} onClose={() => setTarget(null)} />
      )}
    </div>
  );
}

function SetPasswordModal({
  account,
  onClose,
}: {
  account: AccountSummary;
  onClose: () => void;
}) {
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const tooShort = next.length > 0 && next.length < MIN_LENGTH;
  const mismatch = confirm.length > 0 && next !== confirm;
  const canSubmit = next.length >= MIN_LENGTH && next === confirm && !saving;

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!canSubmit) return;
    setError(null);
    setSaving(true);
    try {
      await setAccountPassword(account.id, next);
      showToast(`Password changed for ${account.name}.`, "success");
      onClose();
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : "Couldn't change the password. Try again.",
      );
      setSaving(false);
    }
  }

  return (
    <Modal
      title={`Set password - ${account.name}`}
      width={400}
      onClose={onClose}
    >
      <form
        onSubmit={handleSubmit}
        style={{ display: "grid", gap: 14 }}
        autoComplete="off"
      >
        <Field label="New password">
          <TextInput
            type="password"
            autoComplete="new-password"
            autoFocus
            value={next}
            maxLength={72}
            onChange={(e) => setNext(e.target.value)}
            style={{ width: "100%" }}
          />
        </Field>
        <Field label="Confirm new password">
          <TextInput
            type="password"
            autoComplete="new-password"
            value={confirm}
            maxLength={72}
            onChange={(e) => setConfirm(e.target.value)}
            style={{ width: "100%" }}
          />
        </Field>
        {(tooShort || mismatch || error) && (
          <p
            role="alert"
            style={{ margin: 0, fontSize: "calc(12.5px * var(--ae-fs, 1))", color: colors.danger }}
          >
            {error ??
              (tooShort
                ? `Password must be at least ${MIN_LENGTH} characters.`
                : "Passwords don't match.")}
          </p>
        )}
        <Button type="submit" disabled={!canSubmit}>
          {saving ? "Saving…" : "Change password"}
        </Button>
      </form>
    </Modal>
  );
}
