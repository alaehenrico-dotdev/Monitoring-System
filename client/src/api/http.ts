export const API_URL = import.meta.env.VITE_API_URL ?? "http://localhost:4000/api";

export class ApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

export function getToken(): string | null {
  return localStorage.getItem("ala-eh-token");
}

export function setToken(token: string | null) {
  if (token) localStorage.setItem("ala-eh-token", token);
  else localStorage.removeItem("ala-eh-token");
}

// http.ts sits outside React (AuthContext imports from here, not the other
// way around), so a global 401 - "the session that was here a moment ago is
// no longer valid" - can't call AuthContext's state setters directly. It
// calls this instead, which AuthContext wires up to its own sessionError
// machinery. AuthContext only registers it once its own initial session
// check has finished (see AuthContext.tsx) so that check's own 401/403
// handling - which is deliberately silent, see its comment - stays the only
// thing that runs for it; this only fires for requests after that.
let onUnauthorized: (() => void) | null = null;

export function setUnauthorizedHandler(fn: (() => void) | null) {
  onUnauthorized = fn;
}

async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  const token = getToken();
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...(options.headers as Record<string, string> | undefined),
  };
  if (token) headers.Authorization = `Bearer ${token}`;

  const res = await fetch(`${API_URL}${path}`, { ...options, headers });

  if (!res.ok) {
    const body = await res.json().catch(() => ({ error: res.statusText }));
    if (res.status === 401) {
      setToken(null);
      onUnauthorized?.();
    }
    throw new ApiError(res.status, body.error ?? "Request failed");
  }
  if (res.status === 204) return undefined as T;
  return res.json() as Promise<T>;
}

export const http = {
  get: <T>(path: string) => request<T>(path, { method: "GET" }),
  post: <T>(path: string, body?: unknown) => request<T>(path, { method: "POST", body: JSON.stringify(body) }),
  put: <T>(path: string, body?: unknown) => request<T>(path, { method: "PUT", body: JSON.stringify(body) }),
  patch: <T>(path: string, body?: unknown) => request<T>(path, { method: "PATCH", body: JSON.stringify(body) }),
  delete: <T>(path: string) => request<T>(path, { method: "DELETE" }),
};
