import { useState, useSyncExternalStore } from "react";
import { getServerHealthSnapshot, subscribeServerHealth } from "../api/serverHealth";

/// Tracks reachability of the configured API, not just whether the device
/// has a network interface. Pages use reconnects to reload their current
/// data from the server after an offline period.
///
/// Reads the shared poller in api/serverHealth.ts rather than polling on its
/// own - this hook is mounted several times per page, and each instance used
/// to run its own 5s /health interval (each of which runs a `SELECT 1`).
/// Same shape as before, so callers are unchanged.
export function useOnlineStatus() {
  const { reachable, reconnects } = useSyncExternalStore(
    subscribeServerHealth,
    getServerHealthSnapshot,
    getServerHealthSnapshot,
  );
  // Counted from this instance's own mount, so `reconnects` starts at 0 here
  // whatever the shared poller has already seen - same as when every hook
  // kept its own counter.
  const [reconnectBaseline] = useState(() => reconnects);

  // Optimistic until the first check answers: fall back to the browser's own
  // flag rather than claiming the server is down before anything has asked.
  const online = reachable ?? (typeof navigator === "undefined" ? true : navigator.onLine);

  return { online, reconnects: reconnects - reconnectBaseline };
}
