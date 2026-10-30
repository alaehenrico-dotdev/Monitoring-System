import {
  createContext,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";
import {
  changePassword as changePasswordRequest,
  getMe,
  login as loginRequest,
  loginWithCode,
  signOutEverywhere as signOutEverywhereRequest,
} from "../api/auth";
import {
  ApiError,
  getToken,
  setToken,
  setUnauthorizedHandler,
} from "../api/http";
import type { AuthUser } from "../types";
import { parkDraftsForLogout, restoreDraftBackup } from "../utils/draftBackup";
import { countAllUnsavedWork } from "../utils/unsavedWork";
import { isDeviceRemembered, saveDeviceChoice } from "../utils/rememberDevice";

interface AuthContextValue {
  user: AuthUser | null;
  loading: boolean;
  /// Resolves with `{ mfaToken }` when the account has two-step verification on: the
  /// sign-in is then finished with `completeMfa`. Resolves with null once signed in.
  login: (username: string, password: string, rememberDevice?: boolean) => Promise<{ mfaToken: string } | null>;
  completeMfa: (mfaToken: string, code: string) => Promise<void>;
  /// Signs this account out on every other device (and keeps this one signed in).
  signOutEverywhere: () => Promise<void>;
  /// Changes the signed-in user's own password (other sessions are signed out).
  changeOwnPassword: (currentPassword: string, newPassword: string) => Promise<void>;
  /// Re-reads who is signed in (e.g. after turning two-step verification on or off).
  refreshUser: () => Promise<void>;
  logout: () => void;
  /// Set only when the initial session check (below) failed for a reason
  /// OTHER than "not actually logged in" - a network/server failure while a
  /// token did exist, say. Distinguishing this from an invalid/expired token
  /// matters because that's the ordinary, silent case (a first-time visitor,
  /// or a session that's genuinely expired) - conflating the two would leave
  /// someone whose backend is simply unreachable staring at a blank login
  /// form with no explanation of why they were logged out.
  sessionError: string | null;
  /// True while the server has rejected our token but there is unsaved work on
  /// screen. Instead of bouncing to the login page (which unmounts the grids),
  /// Layout shows a re-login dialog over the page; edits stay exactly as they were.
  sessionExpired: boolean;
  /// Marks the session expired from the client side (the token's own expiry
  /// passed) - a no-op unless there is unsaved work, same rule as a 401.
  expireSession: () => void;
  /// Signs the CURRENT user back in over the expired session.
  /// Resolves with `{ mfaToken }` when the account also needs a code: finish with
  /// `reauthenticateWithCode`. Resolves with null once the session is valid again.
  reauthenticate: (password: string) => Promise<{ mfaToken: string } | null>;
  reauthenticateWithCode: (mfaToken: string, code: string) => Promise<void>;
  /// Log out from the expired-session dialog but keep the unsaved edits for
  /// this user's next sign-in (see utils/draftBackup.ts).
  logoutKeepingDrafts: () => void;
  /// How many sheets of unsaved edits were restored from the local backup at
  /// sign-in (0 = none) - Layout shows a one-time notice.
  recoveredDrafts: number;
  dismissRecovered: () => void;
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [loading, setLoading] = useState(true);
  const [sessionError, setSessionError] = useState<string | null>(null);
  const [sessionExpired, setSessionExpired] = useState(false);
  const [recoveredDrafts, setRecoveredDrafts] = useState(0);

  // Puts back edits that survived a closed window/crash BEFORE the user is
  // set: the pages read their staged edits once, when they mount, and they
  // only mount once there is a user.
  function adopt(authUser: AuthUser) {
    const restored = restoreDraftBackup(authUser.id);
    if (restored > 0) setRecoveredDrafts(restored);
    setUser(authUser);
  }

  useEffect(() => {
    const hadToken = getToken() !== null;

    getMe()
      .then(adopt)
      .catch((e) => {
        const isAuthFailure =
          e instanceof ApiError && (e.status === 401 || e.status === 403);
        if (isAuthFailure || !hadToken) {
          // No stored session or an invalid token is the ordinary, expected
          // path to the login screen and needs no additional explanation.
          setToken(null);
          setUser(null);
          return;
        }
        // A token existed and the request still failed for some other reason
        // - don't wipe out what might still be a perfectly valid session over
        // a transient failure.
        setSessionError(
          e instanceof Error
            ? e.message
            : "Couldn't reach the server - check your connection and try again.",
        );
      })
      .finally(() => {
        setLoading(false);
        // Registered only now (not above) so this same 401/403 - already
        // handled, silently, just above - can't also trip the global
        // handler and overwrite that with an "expired" message. From here
        // on, a 401 on any other request means a session that WAS valid
        // just stopped being valid (revoked, deactivated, expired mid-use).
        setUnauthorizedHandler(() => {
          // Unsaved edits on screen: keep the page (and the edits) and ask
          // for the password in place instead of silently logging out.
          if (countAllUnsavedWork() > 0) {
            setSessionExpired(true);
            return;
          }
          setUser(null);
          setSessionError("Your session expired - please log in again.");
        });
      });

    return () => setUnauthorizedHandler(null);
  }, []);

  /// Stores the token and loads the full profile (/auth/me carries the account-security
  /// flags the login response does not). A profile that cannot be read leaves no session.
  async function startSession(token: string) {
    setToken(token);
    try {
      adopt(await getMe());
    } catch (err) {
      setToken(null);
      throw err;
    }
    setSessionError(null);
    setSessionExpired(false);
  }

  async function login(username: string, password: string, rememberDevice = false) {
    const result = await loginRequest(username, password, rememberDevice);
    // Recorded as soon as the password is right (also for the two-step branch, whose
    // second request carries no flag: the server keeps the choice inside its token).
    saveDeviceChoice(rememberDevice, username);
    if ("mfaRequired" in result) return { mfaToken: result.mfaToken };
    await startSession(result.token);
    return null;
  }

  async function completeMfa(mfaToken: string, code: string) {
    const { token } = await loginWithCode(mfaToken, code);
    await startSession(token);
  }

  async function changeOwnPassword(currentPassword: string, newPassword: string) {
    const { token } = await changePasswordRequest(currentPassword, newPassword, isDeviceRemembered());
    await startSession(token);
  }

  async function signOutEverywhere() {
    const { token } = await signOutEverywhereRequest(isDeviceRemembered());
    await startSession(token);
  }

  async function refreshUser() {
    adopt(await getMe());
  }

  function logout() {
    setToken(null);
    setUser(null);
    setSessionExpired(false);
  }

  function expireSession() {
    if (countAllUnsavedWork() > 0) setSessionExpired(true);
  }

  async function reauthenticate(password: string) {
    if (!user) throw new Error("Not signed in.");
    // Same choice as when this device signed in, so a remembered device stays remembered.
    const result = await loginRequest(user.username, password, isDeviceRemembered());
    if ("mfaRequired" in result) return { mfaToken: result.mfaToken };
    resumeSession(result.token, result.user);
    return null;
  }

  async function reauthenticateWithCode(mfaToken: string, code: string) {
    if (!user) throw new Error("Not signed in.");
    const result = await loginWithCode(mfaToken, code);
    resumeSession(result.token, result.user);
  }

  /// Same person, valid session again: keeps the profile flags the login response lacks.
  function resumeSession(token: string, claims: AuthUser) {
    setToken(token);
    // If the person signed out while the request was in flight there is nobody to resume.
    setUser((current) => (current ? { ...current, ...claims } : current));
    setSessionExpired(false);
  }

  function logoutKeepingDrafts() {
    if (user) parkDraftsForLogout(user.id);
    setToken(null);
    setUser(null);
    setSessionExpired(false);
    setSessionError(
      "Your session expired - please log in again. Your unsaved edits were kept and will be back when you sign in.",
    );
  }

  return (
    <AuthContext.Provider
      value={{
        user,
        loading,
        login,
        completeMfa,
        signOutEverywhere,
        changeOwnPassword,
        refreshUser,
        logout,
        sessionError,
        sessionExpired,
        expireSession,
        reauthenticate,
        reauthenticateWithCode,
        logoutKeepingDrafts,
        recoveredDrafts,
        dismissRecovered: () => setRecoveredDrafts(0),
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within an AuthProvider");
  return ctx;
}
