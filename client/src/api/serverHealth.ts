// One health poller for the whole app.
//
// Whether the CONFIGURED server is reachable - distinct from the browser's
// own navigator.onLine, which only reflects whether this machine has some
// network interface up at all. A machine can be on working Wi-Fi while the
// specific office server is unreachable (wrong subnet, VPN down, server
// process crashed), so "is the OS online" isn't good enough here.
//
// The interval is module-level: it starts when the first consumer subscribes
// and stops when the last unsubscribes, so multiple mounted consumers share
// one health check instead of each querying the database.
import { API_URL } from "./http";

export const HEALTH_CHECK_INTERVAL_MS = 5_000;
export const HEALTH_CHECK_TIMEOUT_MS = 2_000;

export interface ServerHealthSnapshot {
  /// null until the first check has answered - "not known yet", which the
  /// two hooks deliberately read differently (see their own comments).
  reachable: boolean | null;
  /// Monotonic count of "not reachable" -> "reachable" transitions. Each
  /// hook reports this relative to its own mount, so a consumer sees 0 until
  /// a reconnect actually happens while it is mounted.
  reconnects: number;
}

let snapshot: ServerHealthSnapshot = { reachable: null, reconnects: 0 };
const listeners = new Set<() => void>();
let interval: number | undefined;
let inFlight: Promise<void> | null = null;

/// One-shot reachability probe. Exported for callers that need an answer
/// right now rather than the polled value.
export async function checkServerReachable(): Promise<boolean> {
  if (typeof navigator !== "undefined" && !navigator.onLine) return false;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), HEALTH_CHECK_TIMEOUT_MS);
  try {
    const url = new URL("/health", new URL(API_URL, window.location.href));
    const response = await fetch(url, { signal: controller.signal, cache: "no-store" });
    return response.ok;
  } catch {
    return false;
  } finally {
    clearTimeout(timeout);
  }
}

function publish(reachable: boolean) {
  const wasReachable = snapshot.reachable === true;
  const reconnects = snapshot.reconnects + (reachable && !wasReachable ? 1 : 0);
  if (snapshot.reachable === reachable && reconnects === snapshot.reconnects) return;
  snapshot = { reachable, reconnects };
  for (const listener of listeners) listener();
}

/// Runs one check and publishes the result. Deduped: an interval tick and an
/// online/offline event arriving together share a single in-flight request
/// rather than each hitting /health.
export function refreshServerHealth(): Promise<void> {
  if (inFlight) return inFlight;
  inFlight = checkServerReachable()
    .then(publish)
    .finally(() => {
      inFlight = null;
    });
  return inFlight;
}

// Stable reference so add/removeEventListener pair up.
const onNetworkChange = () => {
  void refreshServerHealth();
};

function start() {
  void refreshServerHealth();
  interval = window.setInterval(() => void refreshServerHealth(), HEALTH_CHECK_INTERVAL_MS);
  // An immediate re-check on the browser's own transitions, rather than
  // waiting out the rest of the interval.
  window.addEventListener("online", onNetworkChange);
  window.addEventListener("offline", onNetworkChange);
}

function stop() {
  if (interval !== undefined) window.clearInterval(interval);
  interval = undefined;
  window.removeEventListener("online", onNetworkChange);
  window.removeEventListener("offline", onNetworkChange);
}

/// Subscribe/getSnapshot pair for useSyncExternalStore. The poller runs only
/// while at least one consumer is subscribed.
export function subscribeServerHealth(listener: () => void): () => void {
  listeners.add(listener);
  if (listeners.size === 1) start();
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0) stop();
  };
}

export function getServerHealthSnapshot(): ServerHealthSnapshot {
  return snapshot;
}
