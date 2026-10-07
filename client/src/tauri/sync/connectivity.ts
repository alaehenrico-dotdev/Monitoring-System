// Whether the CONFIGURED server is reachable - distinct from the browser's
// own navigator.onLine/online-offline events, which only reflect whether
// this machine has some network interface up at all. A machine can be on a
// working Wi-Fi network while the specific office server is unreachable
// (wrong subnet, VPN down, server process crashed) - exactly the class of
// problem this app's earlier CORS/wrong-LAN-IP debugging was about, so "is
// the OS online" isn't good enough here.
//
// The polling itself lives in api/serverHealth.ts, shared with
// hooks/useOnlineStatus.ts - this file used to run a second interval of its
// own against the same /health endpoint.
import { useState, useSyncExternalStore } from "react";
import { getServerHealthSnapshot, subscribeServerHealth } from "../../api/serverHealth";

export { checkServerReachable } from "../../api/serverHealth";

/// Reachability of the configured server, plus a `reconnects` counter that
/// bumps only on an actual unreachable -> reachable transition (not on every
/// poll tick), for the sync engine to react to.
export function useServerConnectivity() {
  const { reachable, reconnects } = useSyncExternalStore(
    subscribeServerHealth,
    getServerHealthSnapshot,
    getServerHealthSnapshot,
  );
  // Counted from this hook's own mount, so useSyncEngine's `reconnects > 0`
  // guard still means "a reconnect happened while the engine was running"
  // and not "the poller has reconnected at some point", which would fire a
  // duplicate sync on mount alongside the engine's own launch sync.
  const [reconnectBaseline] = useState(() => reconnects);

  // Pessimistic until the first check answers: stay in offline mode until
  // the configured server's health endpoint has actually succeeded.
  // navigator.onLine alone cannot establish this.
  return { isReachable: reachable === true, reconnects: reconnects - reconnectBaseline };
}
