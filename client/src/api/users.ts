import { http } from "./http";
import type { Role } from "../types";

export interface AccountSummary {
  id: number;
  name: string;
  username: string;
  role: Role;
  isActive: boolean;
}

/// Supervisor/Admin only (the server enforces it).
export function listAccounts() {
  return http.get<AccountSummary[]>("/users");
}

/// Admin sets another account's (or their own) password. Passwords can only
/// be changed this way - there is no self-service change for encoders.
export function setAccountPassword(userId: number, password: string) {
  return http.patch<{ success: boolean }>(`/users/${userId}/password`, { password });
}

/// Admin issues a one-time code for someone who forgot their password. Needs the admin's own
/// password. The code is returned once; the server keeps only its hash.
export function issueResetCode(userId: number, password: string) {
  return http.post<{ code: string; expiresAt: string }>(`/users/${userId}/reset-code`, { password });
}
