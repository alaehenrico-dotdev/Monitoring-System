import { useEffect, useState, type FormEvent } from "react";
import {
  issueResetCode,
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
  const [codeTarget, setCodeTarget] = useState<AccountSummary | null>(null);

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
                    {a.role === "SUPERVISOR_ADMIN" ? "Admin" : "Encoder"}
                  </span>
                  {!a.isActive && (
                    <span className="ae-account-role ae-account-role--off">
                      inactive
                    </span>
                  )}
                </div>
              </div>
              <div className="ae-account-actions">
                <Button
                  variant="secondary"
                  className="ae-btn-solid"
                  size="sm"
                  onClick={() => setTarget(a)}
                >
                  Set password
                </Button>
                {a.isActive && (
                  <Button
                    variant="secondary"
                    className="ae-btn-solid"
                    size="sm"
                    title="For someone who forgot their password: a one-time code they enter on the login page"
                    onClick={() => setCodeTarget(a)}
                  >
                    Reset code
                  </Button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
      {target && (
        <SetPasswordModal account={target} onClose={() => setTarget(null)} />
      )}
      {codeTarget && (
        <ResetCodeModal account={codeTarget} onClose={() => setCodeTarget(null)} />
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

/// Issues the one-time code for someone who forgot their password. Two steps: the admin
/// confirms their own password, then the code is shown once to read out or hand over.
function ResetCodeModal({ account, onClose }: { account: AccountSummary; onClose: () => void }) {
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [issued, setIssued] = useState<{ code: string; expiresAt: Date } | null>(null);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!password || busy) return;
    setError(null);
    setBusy(true);
    try {
      const r = await issueResetCode(account.id, password);
      setIssued({ code: r.code, expiresAt: new Date(r.expiresAt) });
      setPassword("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't issue a reset code. Try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal title={`Reset code - ${account.name}`} width={400} onClose={onClose}>
      {!issued ? (
        <form onSubmit={handleSubmit} style={{ display: "grid", gap: 14 }} autoComplete="off">
          <p style={{ margin: 0, fontSize: "calc(12.5px * var(--ae-fs, 1))", lineHeight: 1.5, color: colors.subtleInk }}>
            For {account.name} to set a new password after forgetting theirs. Confirm your own password to create a one-time code.
          </p>
          <Field label="Your password">
            <TextInput
              type="password"
              autoComplete="current-password"
              autoFocus
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              style={{ width: "100%" }}
            />
          </Field>
          {error && (
            <p role="alert" style={{ margin: 0, fontSize: "calc(12.5px * var(--ae-fs, 1))", color: colors.danger }}>
              {error}
            </p>
          )}
          <Button type="submit" disabled={busy || !password} loading={busy} loadingLabel="Creating…">
            Create reset code
          </Button>
        </form>
      ) : (
        <div style={{ display: "grid", gap: 14 }}>
          <div className="ae-code-block" style={{ fontSize: "calc(20px * var(--ae-fs, 1))", textAlign: "center", letterSpacing: "0.12em" }}>
            {issued.code}
          </div>
          <p style={{ margin: 0, fontSize: "calc(12.5px * var(--ae-fs, 1))", lineHeight: 1.5, color: colors.subtleInk }}>
            Give this to {account.name} in person or by phone, not in a group chat. It works once, expires at{" "}
            <strong style={{ color: colors.ink }}>{issued.expiresAt.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</strong> (30 minutes), and replaces any earlier code. They enter it with their username under{" "}
            <em>Forgot password?</em> on the login page. It is shown only now.
          </p>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <Button
              type="button"
              variant="secondary"
              style={{ flex: "1 1 120px" }}
              onClick={() => {
                void navigator.clipboard?.writeText(issued.code).then(() => showToast("Reset code copied.", "success"));
              }}
            >
              Copy
            </Button>
            <Button type="button" style={{ flex: "2 1 160px" }} onClick={onClose}>
              Done
            </Button>
          </div>
        </div>
      )}
    </Modal>
  );
}
