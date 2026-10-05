import { useSyncExternalStore } from "react";
// Shared, best-effort signal for whether the configured server was reachable
// last time anything checked - lets request() in http.ts skip straight to the
// offline fallback (cache/outbox) instead of paying out REQUEST_TIMEOUT_MS
// again on every call while the server is already known to be down. Written
// by the health-check hooks (useOnlineStatus.ts, tauri/sync/connectivity.ts),
// which already poll this independently every 30s; read-only everywhere
// else. null means "no check has happened yet" - treated as "try the
// network", same as before this existed.
let knownReachable: boolean | null = null;
const listeners = new Set<() => void>();

export function getKnownReachable(): boolean | null {
  return knownReachable;
}

export function setKnownReachable(value: boolean) {
  if (knownReachable === value) return;
  knownReachable = value;
  listeners.forEach((l) => l());
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

// React view of the same signal, for UI that should react to the server
// going away (e.g. PageHeader's red border). Re-renders only when the value
// actually flips. "No check yet" counts as reachable so nothing flashes red
// on first paint.
export function useServerReachable(): boolean {
  return useSyncExternalStore(subscribe, () => knownReachable !== false);
}
