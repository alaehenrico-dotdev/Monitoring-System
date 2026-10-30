import { http } from "./http";
import type { AuthUser } from "../types";

export type LoginResponse =
  | { token: string; user: AuthUser }
  | { mfaRequired: true; mfaToken: string };

export function login(username: string, password: string, rememberDevice = false) {
  return http.post<LoginResponse>("/auth/login", { username, password, rememberDevice });
}

/// Second step of a two-step sign-in: the half-way token from `login` plus a 6-digit
/// code from the authenticator app (or a one-time recovery code).
export function loginWithCode(mfaToken: string, code: string) {
  return http.post<{ token: string; user: AuthUser }>("/auth/login/mfa", { mfaToken, code });
}

export function getMe() {
  return http.get<AuthUser>("/auth/me");
}

/// Changes the signed-in user's own password. The server signs out every other
/// session and returns a fresh token for this one.
export function changePassword(currentPassword: string, newPassword: string, rememberDevice = false) {
  return http.post<{ token: string; user: AuthUser }>("/auth/change-password", { currentPassword, newPassword, rememberDevice });
}

/// Ends the user's sessions on every device; the response is a fresh token for this one.
export function signOutEverywhere(rememberDevice = false) {
  return http.post<{ token: string; user: AuthUser }>("/auth/sign-out-everywhere", { rememberDevice });
}

export function startMfaSetup(password: string) {
  return http.post<{ secret: string; otpauthUrl: string }>("/auth/mfa/setup", { password });
}

export function enableMfa(code: string) {
  return http.post<{ recoveryCodes: string[] }>("/auth/mfa/enable", { code });
}

export function disableMfa(password: string, code: string) {
  return http.post<{ success: true }>("/auth/mfa/disable", { password, code });
}
