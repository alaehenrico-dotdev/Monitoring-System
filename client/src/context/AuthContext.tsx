import {
  createContext,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";
import { getMe, login as loginRequest } from "../api/auth";
import {
  ApiError,
  getToken,
  setToken,
  setUnauthorizedHandler,
} from "../api/http";
import type { AuthUser } from "../types";
import { parkDraftsForLogout, restoreDraftBackup } from "../utils/draftBackup";
import { countAllUnsavedWork } from "../utils/unsavedWork";

interface AuthContextValue {
  user: AuthUser | null;
  loading: boolean;
  login: (username: string, password: string) => Promise<void>;
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
  reauthenticate: (password: string) => Promise<void>;
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

  async function login(username: string, password: string) {
    const { token, user: authUser } = await loginRequest(username, password);
    setToken(token);
    adopt(authUser);
    setSessionError(null);
    setSessionExpired(false);
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
    const { token, user: authUser } = await loginRequest(
      user.username,
      password,
    );
    setToken(token);
    setUser(authUser);
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
        logout,
        sessionError,
        sessionExpired,
        expireSession,
        reauthenticate,
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
