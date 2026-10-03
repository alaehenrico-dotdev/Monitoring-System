import { clearOfflineApiCache } from "../pwa";
import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { getMe, login as loginRequest } from "../api/auth";
import { ApiError, getToken, setToken, setUnauthorizedHandler } from "../api/http";
import { decodeJwtPayload } from "../utils/jwt";
import type { AuthUser } from "../types";

const isTauri = import.meta.env.MODE === "tauri";

// Desktop build only, and only when a token already exists: the token's own
// payload (decoded without verifying its signature - not a trust decision,
// since every real request still carries this exact token and the server
// verifies it for real; this only ever affects what name/role this client
// DISPLAYS until getMe() confirms it), so the app can render from it on the
// very first render instead of blocking behind ProtectedRoute's loading
// screen for however long getMe() takes to succeed or time out. This is
// what makes "server down" behave like "wifi off" at startup - this same
// fallback used to only run *after* waiting out getMe()'s full network
// timeout, in its .catch below, which was exactly the slow-vs-fast
// asymmetry this was written to fix.
function decodeOptimisticUser(): AuthUser | null {
  if (!isTauri) return null;
  const token = getToken();
  return token ? decodeJwtPayload<AuthUser>(token) : null;
}

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
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(decodeOptimisticUser);
  const [loading, setLoading] = useState(() => decodeOptimisticUser() === null);
  const [sessionError, setSessionError] = useState<string | null>(null);

  useEffect(() => {
    const hadToken = getToken() !== null;
    // getMe() still runs either way, in the background, to get the current,
    // authoritative state - this only decides what the .catch below does if
    // that fails.
    const optimisticallyShown = isTauri && hadToken && decodeOptimisticUser() !== null;

    getMe()
      .then(setUser)
      .catch((e) => {
        const isAuthFailure = e instanceof ApiError && (e.status === 401 || e.status === 403);
        if (isAuthFailure || !hadToken) {
          // Either there was never a session to begin with, or the token
          // really is invalid/expired - both are the ordinary, expected path
          // to the login screen, nothing to explain. Also undoes the
          // optimistic decode above, if any - a token that just failed
          // verification isn't a valid session to keep displaying.
          setToken(null);
          setUser(null);
          return;
        }
        // A token existed and the request still failed for some other reason
        // - don't wipe out what might still be a perfectly valid session over
        // a transient failure.
        //
        // Already showing the decoded token's identity from above - stay on
        // it. If decoding it failed back there instead (corrupted token), or
        // this isn't the desktop build, fall through to the ordinary
        // sessionError screen - that's not something to silently paper over.
        if (isTauri && e instanceof TypeError && optimisticallyShown) return;
        setSessionError(e instanceof Error ? e.message : "Couldn't reach the server - check your connection and try again.");
      })
      .finally(() => {
        setLoading(false);
        // Registered only now (not above) so this same 401/403 - already
        // handled, silently, just above - can't also trip the global
        // handler and overwrite that with an "expired" message. From here
        // on, a 401 on any other request means a session that WAS valid
        // just stopped being valid (revoked, deactivated, expired mid-use).
        setUnauthorizedHandler(() => {
          setUser(null);
          setSessionError("Your session expired - please log in again.");
        });
      });

    return () => setUnauthorizedHandler(null);
  }, []);

  async function login(username: string, password: string) {
    const { token, user: authUser } = await loginRequest(username, password);
    setToken(token);
    setUser(authUser);
    setSessionError(null);
  }

  function logout() {
    clearOfflineApiCache();
    setToken(null);
    setUser(null);
  }

  return <AuthContext.Provider value={{ user, loading, login, logout, sessionError }}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within an AuthProvider");
  return ctx;
}
