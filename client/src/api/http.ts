import { getKnownReachable, setKnownReachable } from "./reachability";

const SERVER_URL_STORAGE_KEY = "ala-eh-server-url";

// Baked in at build time from VITE_API_URL - fine for the web build, which
// always rides through the same origin's proxy/tunnel (see PRODUCTION.md),
// but the Tauri desktop build talks to an absolute LAN address that changes
// whenever the server machine's IP does. Rebuilding and redistributing the
// installer every time that happens is the "annoying" part this override
// fixes - ServerSettings.tsx lets a user point the installed app at a new
// address without a developer involved.
const DEFAULT_API_URL = import.meta.env.VITE_API_URL ?? "http://localhost:4000/api";

export function getDefaultApiUrl(): string {
  return DEFAULT_API_URL;
}

export function getStoredApiUrl(): string | null {
  return localStorage.getItem(SERVER_URL_STORAGE_KEY);
}

export const API_URL = getStoredApiUrl() ?? DEFAULT_API_URL;

// Persists the override and reloads the page - simpler and more reliable
// than trying to hot-swap every live consumer of API_URL (the open realtime
// WebSocket in RealtimeContext, in-flight health-check polling, the offline
// sync engine) mid-session. The old session's token is cleared too since
// it belongs to whichever server issued it, not necessarily the new one.
export function setApiUrl(url: string) {
  const normalized = url.trim().replace(/\/+$/, "");
  localStorage.setItem(SERVER_URL_STORAGE_KEY, normalized);
  setToken(null);
  window.location.reload();
}

export function resetApiUrl() {
  localStorage.removeItem(SERVER_URL_STORAGE_KEY);
  setToken(null);
  window.location.reload();
}

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
    super("Saved offline. Syncs when reconnected.");
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

// A plain fetch() has no timeout of its own - against a server that's
// genuinely unreachable (the machine is off, not just the process), the
// underlying OS TCP connect attempt is what eventually fails, which can take
// 20-60+ seconds. That's fine for a server that might just be slow to
// respond, but every offline-fallback path in this file (and api/onlineStock
// .ts, offlineStock.ts, manualCounts.ts, AuthContext.tsx's session check)
// only kicks in once this call actually fails - so "detect offline and show
// local data" was waiting out that same OS timeout first. Aborting well
// before that (see connectivity.ts's own, separate health-check timeout for
// the same reasoning) is what actually makes the fallback feel instant
// instead of stalled. Every endpoint this app calls is a simple local-LAN
// CRUD/report query, so 4s is already generous slack above normal latency.
const REQUEST_TIMEOUT_MS = 4_000;

// The actual HTTP call plus auth header/401/ApiError handling - no offline
// interception. Used directly by sendQueuedWrite() and the structured sync
// engine (src/tauri/sync/engine.ts) - both need a real network error to
// surface as-is rather than be caught and funneled into the GENERIC
// cache/outbox below, which would create a confusing second, untracked copy
// of something the structured sync tables (or the outbox replay itself)
// already own.
export async function coreRequest<T>(path: string, options: RequestInit = {}): Promise<T> {
  const token = getToken();
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...(options.headers as Record<string, string> | undefined),
  };
  if (token) headers.Authorization = `Bearer ${token}`;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  let res: Response;
  try {
    res = await fetch(`${API_URL}${path}`, { ...options, headers, signal: controller.signal });
  } catch (err) {
    if (isTauri) setKnownReachable(false);
    // A timed-out fetch throws a DOMException("AbortError"), not the
    // TypeError every "couldn't reach it" check in this codebase looks for
    // (isNetworkError here and in offlineStore.ts, plus direct `instanceof
    // TypeError` checks in the api/* modules and AuthContext.tsx) -
    // normalized here so a timeout is indistinguishable from any other
    // connectivity failure to every one of those, rather than teaching each
    // of them a second error shape to recognize.
    if (err instanceof DOMException && err.name === "AbortError") {
      // `new TypeError(message, { cause })` needs an ES2022 lib - this
      // project targets ES2020 (tsconfig.json), so cause is set as a plain
      // property instead. Same runtime behavior either way.
      const timeoutError = new TypeError("Request timed out");
      (timeoutError as TypeError & { cause?: unknown }).cause = err;
      throw timeoutError;
    }
    throw err;
  } finally {
    clearTimeout(timeout);
  }

  if (!res.ok) {
    if (isTauri) setKnownReachable(true);
    const body = await res.json().catch(() => ({ error: res.statusText }));
    if (res.status === 401) {
      setToken(null);
      onUnauthorized?.();
    }
    throw new ApiError(res.status, body.error ?? "Request failed");
  }
  if (isTauri) setKnownReachable(true);
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

// The generic outbox (tauri/offlineStore.ts) replays a queued write by
// re-sending it verbatim once reconnected, with no idempotency key - safe
// only for a method whose server handler treats the body as an absolute
// "set this" rather than "do this once" (PUT/PATCH update a known resource
// to the given state; a duplicate replay after a crash mid-flush just sets
// it to the same state again). POST creates a NEW resource each time it's
// processed - every endpoint this app POSTs to (products, import batches,
// report history, system log) would create a second row on a duplicate
// replay. So POST is deliberately excluded from auto-queueing here: offline,
// it fails with a plain network error immediately, the same as it would
// with no offline support at all, rather than silently queuing something
// that can't be safely retried unattended.
function isQueueableMethod(method: string): boolean {
  return method === "PUT" || method === "PATCH" || method === "DELETE";
}

async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  const method = options.method ?? "GET";

  // The health-check hooks already poll server reachability independently of
  // any individual request - if the last poll found it down, don't pay out
  // REQUEST_TIMEOUT_MS again just to rediscover that on every single call
  // (the whole reason the server-down case feels slower than wifi-off:
  // wifi-off fails a fetch almost instantly, but a reachable network with an
  // unreachable server has to wait out the full connect timeout instead).
  // In the desktop app, serve saved data as soon as connectivity has not yet
  // been established (including cold start) or the last probe found the
  // server down. Waiting for TCP's connect timeout just to rediscover this
  // makes locally saved data look like a failed fetch. Keep trying the API
  // in the background to refresh the cache, but return the local snapshot
  // immediately when one exists.
  if (isTauri && (getKnownReachable() === false || getKnownReachable() === null) && method === "GET") {
    const { getCachedResponse } = await import("../tauri/offlineStore");
    const cached = await getCachedResponse<T>(path);
    if (cached !== null) {
      void coreRequest<T>(path, options)
        .then(async (fresh) => {
          const { cacheResponse } = await import("../tauri/offlineStore");
          await cacheResponse(path, fresh);
        })
        .catch(() => undefined);
      return cached;
    }
  }

  if (isTauri && getKnownReachable() === false) {
    if (isQueueableMethod(method)) {
      const { queueWrite } = await import("../tauri/offlineStore");
      await queueWrite(method, path, options.body as string | undefined);
      throw new QueuedOfflineError();
    }
    if (method === "GET") {
      const { getCachedResponse } = await import("../tauri/offlineStore");
      const cached = await getCachedResponse<T>(path);
      if (cached !== null) return cached;
    }
    // POST: fall through to a real attempt below, which will fail with the
    // genuine network error (isQueueableMethod is false for it) - there's
    // nothing cached to serve for a create, and nothing safe to queue.
  }

  let data: T;
  try {
    data = await coreRequest<T>(path, options);
  } catch (err) {
    if (!isTauri || !isNetworkError(err)) throw err;
    if (isQueueableMethod(method)) {
      const { queueWrite } = await import("../tauri/offlineStore");
      await queueWrite(method, path, options.body as string | undefined);
      throw new QueuedOfflineError();
    }
    if (method === "GET") {
      const { getCachedResponse } = await import("../tauri/offlineStore");
      const cached = await getCachedResponse<T>(path);
      if (cached !== null) return cached;
    }
    throw err;
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
