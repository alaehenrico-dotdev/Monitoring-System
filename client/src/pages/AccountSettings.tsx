import { useEffect, useState, type FormEvent, type ReactNode } from "react";
import { disableMfa, enableMfa, setRecoveryEmail, startMfaSetup } from "../api/auth";
import { ChangePasswordForm } from "../components/ChangePasswordForm";
import { Modal } from "../components/Modal";
import { QrCode } from "../components/QrCode";
import { showToast } from "../components/Toast";
import { Button, Field, TextInput } from "../components/ui";
import { useAuth } from "../context/AuthContext";
import { colors } from "../theme";
import { initials } from "../utils/initials";

const note = { margin: 0, fontSize: "calc(12.5px * var(--ae-fs, 1))", lineHeight: 1.5, color: colors.subtleInk } as const;

/// One setting: title and description on the left, its single action on the right, on the
/// same glass card as the Backup and Restore settings.
function Setting({ title, status, description, children }: { title: string; status?: ReactNode; description: string; children: ReactNode }) {
  return (
    <div className="ae-dash-card ae-setting">
      <div className="ae-setting-text">
        <div className="ae-setting-title">
          {title}
          {status}
        </div>
        <div className="ae-setting-desc">{description}</div>
      </div>
      <div className="ae-setting-action">{children}</div>
    </div>
  );
}

const actionButton = { variant: "secondary", className: "ae-btn-solid", size: "sm" } as const;

/// Every role: your own password, two-step verification, and signing out other devices. Admins
/// manage OTHER people's passwords in the User Passwords tab.
export function AccountSettings() {
  const { user, signOutEverywhere, refreshUser } = useAuth();
  // The confirmation link opens in another tab, so while a new recovery email is waiting, re-check
  // whenever this tab is looked at again instead of showing "Waiting" until a manual reload.
  const waitingForEmail = Boolean(user?.recoveryEmailPending);
  useEffect(() => {
    if (!waitingForEmail) return;
    const recheck = () => {
      if (document.visibilityState === "visible") void refreshUser().catch(() => {});
    };
    recheck();
    window.addEventListener("focus", recheck);
    document.addEventListener("visibilitychange", recheck);
    return () => {
      window.removeEventListener("focus", recheck);
      document.removeEventListener("visibilitychange", recheck);
    };
    // refreshUser is recreated every render; only the waiting flag should restart this.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [waitingForEmail]);
  const [dialog, setDialog] = useState<"password" | "mfa-on" | "mfa-off" | "email" | null>(null);
  const [signingOut, setSigningOut] = useState(false);
  const enabled = Boolean(user?.mfaEnabled);

  function handleSignOutEverywhere() {
    setSigningOut(true);
    signOutEverywhere()
      .then(() => showToast("Signed out on all your other devices.", "success"))
      .catch((e) => showToast(e instanceof Error ? e.message : "Couldn't sign out the other devices.", "error"))
      .finally(() => setSigningOut(false));
  }

  return (
    <div style={{ width: "100%", maxWidth: 640, margin: "0 auto" }}>
      <div className="ae-account-list">
        <div className="ae-dash-card ae-account-card" style={{ cursor: "default" }}>
          <div className="ae-account-avatar" aria-hidden="true">
            {initials(user?.name ?? "")}
          </div>
          <div className="ae-account-info">
            <div className="ae-account-name">{user?.name}</div>
            <div className="ae-account-meta">
              <span>{user?.username}</span>
              <span className="ae-account-role">{user?.role.replace(/_/g, " ")}</span>
            </div>
          </div>
        </div>

        <Setting
          title="Password"
          description="Change your sign-in password. Other devices are signed out."
        >
          <Button {...actionButton} onClick={() => setDialog("password")}>
            Change password
          </Button>
        </Setting>

        <Setting
          title="Two-step verification"
          status={<span className={`ae-account-role${enabled ? " ae-account-role--on" : ""}`}>{enabled ? "On" : "Off"}</span>}
          description={enabled ? "Sign-in needs your password and an app code." : "Adds an app code at sign-in. Recommended for admins."}
        >
          <Button {...actionButton} aria-label={enabled ? undefined : "Set up two-step verification"} onClick={() => setDialog(enabled ? "mfa-off" : "mfa-on")}>
            {enabled ? "Turn off" : "Set up"}
          </Button>
        </Setting>

        {user?.role === "SUPERVISOR_ADMIN" && (
          <Setting
            title="Recovery email"
            status={
              <span className={`ae-account-role${user.recoveryEmail ? " ae-account-role--on" : ""}`}>
                {user.recoveryEmail ? "Verified" : user.recoveryEmailPending ? "Waiting" : "Not set"}
              </span>
            }
            description={
              user.recoveryEmail
                ? `Password reset codes go to ${user.recoveryEmail}.${user.recoveryEmailPending ? ` Waiting for you to confirm ${user.recoveryEmailPending}.` : ""}`
                : user.recoveryEmailPending
                  ? `Waiting for you to open the link we sent to ${user.recoveryEmailPending}.`
                  : "Lets you reset your own password by email if you forget it."
            }
          >
            <Button
              {...actionButton}
              aria-label={user.recoveryEmail || user.recoveryEmailPending ? "Change recovery email" : "Set up recovery email"}
              onClick={() => setDialog("email")}
            >
              {user.recoveryEmail || user.recoveryEmailPending ? "Change" : "Set up"}
            </Button>
          </Setting>
        )}

        <Setting
          title="Signed-in devices"
          description="Sign out all other devices, including remembered ones. This one stays signed in."
        >
          <Button {...actionButton} onClick={handleSignOutEverywhere} loading={signingOut} loadingLabel="Signing out…">
            Sign out others
          </Button>
        </Setting>
      </div>

      {dialog === "password" && (
        <Modal title="Change password" width={400} onClose={() => setDialog(null)}>
          <ChangePasswordForm onDone={() => setDialog(null)} />
        </Modal>
      )}
      {dialog === "mfa-on" && <SetUpTwoStep onClose={() => setDialog(null)} />}
      {dialog === "mfa-off" && <TurnOffTwoStep onClose={() => setDialog(null)} />}
      {dialog === "email" && <RecoveryEmailDialog onClose={() => setDialog(null)} />}
    </div>
  );
}

type Step = "password" | "scan" | "codes";

/// Three steps in one dialog: confirm the password, scan the code and type the first one it
/// shows, then keep the recovery codes. The last step cannot be dismissed by Escape or a
/// click outside - the codes are shown only once.
function SetUpTwoStep({ onClose }: { onClose: () => void }) {
  const { refreshUser } = useAuth();
  const [step, setStep] = useState<Step>("password");
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");
  const [secret, setSecret] = useState<{ key: string; url: string } | null>(null);
  const [recovery, setRecovery] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function run(action: () => Promise<void>) {
    setError(null);
    setBusy(true);
    try {
      await action();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong. Try again.");
    } finally {
      setBusy(false);
    }
  }

  const begin = (e: FormEvent) => {
    e.preventDefault();
    void run(async () => {
      const r = await startMfaSetup(password);
      setSecret({ key: r.secret, url: r.otpauthUrl });
      setPassword("");
      setStep("scan");
    });
  };

  const confirm = (e: FormEvent) => {
    e.preventDefault();
    void run(async () => {
      const r = await enableMfa(code);
      setRecovery(r.recoveryCodes);
      setSecret(null);
      setCode("");
      setStep("codes");
      await refreshUser();
    });
  };

  const alert = error && (
    <p role="alert" style={{ ...note, color: colors.danger }}>
      {error}
    </p>
  );

  return (
    <Modal title="Set up two-step verification" width={420} onClose={step === "codes" ? () => {} : onClose}>
      {step === "password" && (
        <form onSubmit={begin} style={{ display: "grid", gap: 14 }} autoComplete="off">
          <p style={note}>Confirm your password to start.</p>
          <Field label="Password">
            <TextInput type="password" autoComplete="current-password" autoFocus value={password} onChange={(e) => setPassword(e.target.value)} style={{ width: "100%" }} />
          </Field>
          {alert}
          <Button type="submit" disabled={busy || !password} loading={busy} loadingLabel="Checking…">
            Continue
          </Button>
        </form>
      )}

      {step === "scan" && secret && (
        <form onSubmit={confirm} style={{ display: "grid", gap: 14 }} autoComplete="off">
          <p style={note}>
            1. Scan this code in an authenticator app.
          </p>
          <QrCode value={secret.url} label="QR code to add this account to your authenticator app" />
          <p style={note}>
            Can&apos;t scan? Type this key or <a href={secret.url}>open it in the app</a>.
          </p>
          <div className="ae-code-block">{secret.key.match(/.{1,4}/g)?.join(" ")}</div>
          <p style={note}>2. Enter the 6-digit code.</p>
          <Field label="6-digit code">
            <TextInput value={code} onChange={(e) => setCode(e.target.value)} inputMode="numeric" autoComplete="one-time-code" autoFocus style={{ width: "100%" }} />
          </Field>
          {alert}
          <Button type="submit" disabled={busy || code.replace(/\s/g, "").length !== 6} loading={busy} loadingLabel="Checking…">
            Turn on
          </Button>
        </form>
      )}

      {step === "codes" && (
        <div style={{ display: "grid", gap: 14 }}>
          <p style={note}>
            <strong style={{ color: colors.ink }}>Two-step verification is on.</strong>{" "}
            Save these recovery codes safely. Each works once. Shown only now.
          </p>
          <div className="ae-code-block ae-recovery-grid">
            {recovery.map((c) => (
              <div key={c}>{c}</div>
            ))}
          </div>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <Button
              type="button"
              variant="secondary"
              style={{ flex: "1 1 120px" }}
              onClick={() => {
                void navigator.clipboard?.writeText(recovery.join("\n")).then(() => showToast("Recovery codes copied.", "success"));
              }}
            >
              Copy
            </Button>
            <Button type="button" style={{ flex: "2 1 160px" }} onClick={onClose}>
              I have saved them
            </Button>
          </div>
        </div>
      )}
    </Modal>
  );
}

function TurnOffTwoStep({ onClose }: { onClose: () => void }) {
  const { refreshUser } = useAuth();
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      await disableMfa(password, code);
      showToast("Two-step verification is off.", "success");
      await refreshUser();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong. Try again.");
      setBusy(false);
    }
  }

  return (
    <Modal title="Turn off two-step verification" width={400} onClose={onClose}>
      <form onSubmit={handleSubmit} style={{ display: "grid", gap: 14 }} autoComplete="off">
        <p style={note}>Needs your password and an app or recovery code.</p>
        <Field label="Password">
          <TextInput type="password" autoComplete="current-password" autoFocus value={password} onChange={(e) => setPassword(e.target.value)} style={{ width: "100%" }} />
        </Field>
        <Field label="Code">
          <TextInput value={code} onChange={(e) => setCode(e.target.value)} autoComplete="one-time-code" style={{ width: "100%" }} />
        </Field>
        {error && (
          <p role="alert" style={{ ...note, color: colors.danger }}>
            {error}
          </p>
        )}
        <Button type="submit" variant="danger" disabled={busy || !password || !code} loading={busy} loadingLabel="Checking…">
          Turn off
        </Button>
      </form>
    </Modal>
  );
}

/// An admin sets or changes their own recovery email. Needs the current password; the address only
/// counts once the link sent to it is clicked, and the old one stays active until then.
function RecoveryEmailDialog({ onClose }: { onClose: () => void }) {
  const { refreshUser } = useAuth();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [sentTo, setSentTo] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (busy || !email.trim() || !password) return;
    setBusy(true);
    setError(null);
    try {
      await setRecoveryEmail(email.trim(), password);
      setSentTo(email.trim().toLowerCase());
      await refreshUser().catch(() => {});
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't save the email. Try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal title="Recovery email" width={420} onClose={onClose}>
      {sentTo ? (
        <div style={{ display: "grid", gap: 14 }}>
          <p style={note}>
            We sent a confirmation link to <strong>{sentTo}</strong>. It works once and expires in 1 hour. Your current recovery email, if you have one, stays active until you click it.
          </p>
          <Button type="button" onClick={onClose}>
            Done
          </Button>
        </div>
      ) : (
        <form onSubmit={submit} style={{ display: "grid", gap: 14 }} autoComplete="off">
          <p style={note}>If you forget your password, a one-time reset code is emailed here. Enter your password to change it.</p>
          <Field label="Email address">
            <TextInput type="email" autoComplete="email" autoFocus value={email} onChange={(e) => setEmail(e.target.value)} style={{ width: "100%" }} />
          </Field>
          <Field label="Your password">
            <TextInput type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} style={{ width: "100%" }} />
          </Field>
          {error && (
            <p role="alert" style={{ ...note, color: colors.danger }}>
              {error}
            </p>
          )}
          <Button type="submit" disabled={busy || !email.trim() || !password} loading={busy} loadingLabel="Sending…">
            Send confirmation link
          </Button>
        </form>
      )}
    </Modal>
  );
}
