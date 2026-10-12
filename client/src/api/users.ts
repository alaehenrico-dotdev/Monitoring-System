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
