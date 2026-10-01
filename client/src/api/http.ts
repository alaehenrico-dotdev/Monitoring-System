export const API_URL = import.meta.env.VITE_API_URL ?? "http://localhost:4000/api";

export class ApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

/// Thrown instead of a network error for a mutating request (POST/PUT/PATCH/
/// DELETE) made while offline in the Tauri desktop build - the write has
/// been queued (see src/tauri/offlineStore.ts) rather than lost, so callers
/// should treat this as "saved, will sync later" rather than a hard failure.
/// Never thrown in the web build.
export class QueuedOfflineError extends Error {
  constructor() {
    super("Saved offline - will sync once the connection is back.");
  }
}

export function getToken(): string | null {
  return localStorage.getItem("ala-eh-token");
}

export function setToken(token: string | null) {
  if (token) localStorage.setItem("ala-eh-token", token);
  else localStorage.removeItem("ala-eh-token");
}

// API_URL may be relative (e.g. "/api" from .env.local, so the browser only
// ever talks to one origin through the Vite/preview proxy - see
// NGROK_SETUP.md) or absolute - resolve it against the page's own origin
// either way, then swap scheme+path for the realtime endpoint.
export function getWsUrl(): string {
  const apiOrigin = new URL(API_URL, window.location.href);
  const wsProtocol = apiOrigin.protocol === "https:" ? "wss:" : "ws:";
  return `${wsProtocol}//${apiOrigin.host}/ws`;
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

// Offline support (src/tauri/offlineStore.ts) only exists for the Tauri
// desktop build - dynamically imported so its SQLite/DPAPI dependency never
// reaches the plain web build's bundle. isNetworkError() distinguishes a
// fetch() that never got a response at all (offline/unreachable) from one
// that did (ApiError below) - only the former is cacheable/queueable, since
// retrying a real 4xx/5xx from a reachable server would just fail again.
const isTauri = import.meta.env.MODE === "tauri";
function isNetworkError(err: unknown): boolean {
  return err instanceof TypeError;
}

// The actual HTTP call plus auth header/401/ApiError handling - no offline
// interception. Used directly by sendQueuedWrite() (replaying the outbox
// must NOT re-trigger request()'s own catch-and-requeue behavior below, or a
// still-offline replay would duplicate the entry it was trying to flush and
// report it to flushPendingWrites as a server rejection instead of "still
// offline, try again later").
async function coreRequest<T>(path: string, options: RequestInit = {}): Promise<T> {
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
  return (await res.json()) as T;
}

async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  const method = options.method ?? "GET";

  let data: T;
  try {
    data = await coreRequest<T>(path, options);
  } catch (err) {
    if (!isTauri || !isNetworkError(err)) throw err;
    if (method !== "GET") {
      const { queueWrite } = await import("../tauri/offlineStore");
      await queueWrite(method, path, options.body as string | undefined);
      throw new QueuedOfflineError();
    }
    const { getCachedResponse } = await import("../tauri/offlineStore");
    const cached = await getCachedResponse<T>(path);
    if (cached === null) throw err;
    return cached;
  }

  if (isTauri && method === "GET") {
    const { cacheResponse } = await import("../tauri/offlineStore");
    void cacheResponse(path, data);
  }
  return data;
}

export const http = {
  get: <T>(path: string) => request<T>(path, { method: "GET" }),
  post: <T>(path: string, body?: unknown) => request<T>(path, { method: "POST", body: JSON.stringify(body) }),
  put: <T>(path: string, body?: unknown) => request<T>(path, { method: "PUT", body: JSON.stringify(body) }),
  patch: <T>(path: string, body?: unknown) => request<T>(path, { method: "PATCH", body: JSON.stringify(body) }),
  delete: <T>(path: string) => request<T>(path, { method: "DELETE" }),
};

// Replays one outbox entry against the real API (see offlineStore.ts's
// flushPendingWrites). Goes through coreRequest, not request() - a replay
// that's still offline must surface as a plain network error so
// flushPendingWrites' own isNetworkError check can stop and retry later,
// not get caught and re-queued as a brand new (duplicate) pending write.
export async function sendQueuedWrite(method: string, path: string, body: string | undefined): Promise<void> {
  await coreRequest(path, { method, body });
}
