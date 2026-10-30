import { AuthCard, AuthShell } from "../components/AuthShell";
import { ChangePasswordForm } from "../components/ChangePasswordForm";
import { useAuth } from "../context/AuthContext";
import { colors } from "../theme";

/// Shown instead of the whole app while the account still has a password somebody else
/// knows (a seeded account, or one an admin created or reset). The server refuses every
/// other request until this is done, so there is nothing to skip to. Same backdrop and card
/// as the login page, so it reads as the next step of signing in.
export function ForcedPasswordChange() {
  const { user, logout } = useAuth();
  return (
    <AuthShell>
      <AuthCard maxWidth={360}>
        <h2 style={{ margin: "0 0 4px", fontSize: "calc(17px * var(--ae-fs, 1))" }}>Choose your own password</h2>
        <p style={{ margin: "0 0 16px", fontSize: "calc(13px * var(--ae-fs, 1))", lineHeight: 1.5, color: colors.subtleInk }}>
          {user?.name ? `${user.name}, the` : "The"} password you signed in with was set by someone else. Pick one only you know to continue.
        </p>
        <ChangePasswordForm />
        <div style={{ textAlign: "center", marginTop: 8 }}>
          <button type="button" className="ae-link-btn" onClick={logout}>
            Log out
          </button>
        </div>
      </AuthCard>
    </AuthShell>
  );
}
