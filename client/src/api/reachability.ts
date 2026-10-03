// Shared, best-effort signal for whether the configured server was reachable
// last time anything checked - lets request() in http.ts skip straight to the
// offline fallback (cache/outbox) instead of paying out REQUEST_TIMEOUT_MS
// again on every call while the server is already known to be down. Written
// by the health-check hooks (useOnlineStatus.ts, tauri/sync/connectivity.ts),
// which already poll this independently every 30s; read-only everywhere
// else. null means "no check has happened yet" - treated as "try the
// network", same as before this existed.
let knownReachable: boolean | null = null;

export function getKnownReachable(): boolean | null {
  return knownReachable;
}

export function setKnownReachable(value: boolean) {
  knownReachable = value;
}
