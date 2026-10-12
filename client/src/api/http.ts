export const API_URL = import.meta.env.VITE_API_URL ?? "/api";

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

export function getWsUrl(): string {
  const apiOrigin = new URL(API_URL, window.location.href);
  const wsProtocol = apiOrigin.protocol === "https:" ? "wss:" : "ws:";
  return `${wsProtocol}//${apiOrigin.host}/ws`;
}

let onUnauthorized: (() => void) | null = null;

export function setUnauthorizedHandler(fn: (() => void) | null) {
  onUnauthorized = fn;
}

// Reads fail fast so a dead server surfaces quickly. Writes get longer: an
// abort doesn't stop the server committing, so cutting a slow-but-successful
// save at 4s shows "failed" for data that was in fact written (and invites a
// duplicate retry). Wipes/publishes touch many rows and get the longest.
const READ_TIMEOUT_MS = 4_000;
const WRITE_TIMEOUT_MS = 30_000;
const BULK_TIMEOUT_MS = 120_000;
const BULK_PATH = /^\/(data-reset\/|manual-counts\/publish|import-batches)/;

function timeoutFor(path: string, method: string | undefined): number {
  if (BULK_PATH.test(path)) return BULK_TIMEOUT_MS;
  return !method || method === "GET" ? READ_TIMEOUT_MS : WRITE_TIMEOUT_MS;
}

async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  const token = getToken();
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...(options.headers as Record<string, string> | undefined),
  };
  if (token) headers.Authorization = `Bearer ${token}`;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutFor(path, options.method));
  let response: Response;
  try {
    response = await fetch(`${API_URL}${path}`, {
      ...options,
      headers,
      signal: controller.signal,
    });
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") {
      const timeoutError = new TypeError("Request timed out");
      (timeoutError as TypeError & { cause?: unknown }).cause = error;
      throw timeoutError;
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }

  if (!response.ok) {
    const body = await response
      .json()
      .catch(() => ({ error: response.statusText }));
    // A wrong password on the login form (or the re-login dialog) is also a
    // 401, but it isn't an expired session - it must not clear the token or
    // trip the global handler.
    //
    // Only act if the token is still the one this request was sent with. A
    // slow request from before a re-login can come back 401 after the new
    // token is stored; clearing it then would sign the user straight back out.
    if (response.status === 401 && !path.startsWith("/auth/login") && getToken() === token) {
      setToken(null);
      onUnauthorized?.();
    }
    throw new ApiError(response.status, body.error ?? "Request failed");
  }
  if (response.status === 204) return undefined as T;
  return (await response.json()) as T;
}

export const http = {
  get: <T>(path: string) => request<T>(path, { method: "GET" }),
  post: <T>(path: string, body?: unknown) =>
    request<T>(path, { method: "POST", body: JSON.stringify(body) }),
  put: <T>(path: string, body?: unknown) =>
    request<T>(path, { method: "PUT", body: JSON.stringify(body) }),
  patch: <T>(path: string, body?: unknown) =>
    request<T>(path, { method: "PATCH", body: JSON.stringify(body) }),
  delete: <T>(path: string) => request<T>(path, { method: "DELETE" }),
};
