import { http } from "./http";
import type { AuthUser } from "../types";

export function login(username: string, password: string) {
  return http.post<{ token: string; user: AuthUser }>("/auth/login", { username, password });
}

export function getMe() {
  return http.get<AuthUser>("/auth/me");
}
