import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { getMe, login as loginRequest } from "../api/auth";
import { ApiError, getToken, setToken } from "../api/http";
import type { AuthUser } from "../types";

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
  const [user, setUser] = useState<AuthUser | null>(null);
  const [loading, setLoading] = useState(true);
  const [sessionError, setSessionError] = useState<string | null>(null);

  useEffect(() => {
    const hadToken = getToken() !== null;
    getMe()
      .then(setUser)
      .catch((e) => {
        const isAuthFailure = e instanceof ApiError && (e.status === 401 || e.status === 403);
        if (isAuthFailure || !hadToken) {
          // Either there was never a session to begin with, or the token
          // really is invalid/expired - both are the ordinary, expected path
          // to the login screen, nothing to explain.
          setToken(null);
        } else {
          // A token existed and the request still failed for some other
          // reason (network down, server error) - don't wipe out what might
          // still be a perfectly valid session over a transient failure.
          setSessionError(e instanceof Error ? e.message : "Couldn't reach the server - check your connection and try again.");
        }
      })
      .finally(() => setLoading(false));
  }, []);

  async function login(username: string, password: string) {
    const { token, user: authUser } = await loginRequest(username, password);
    setToken(token);
    setUser(authUser);
    setSessionError(null);
  }

  function logout() {
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
