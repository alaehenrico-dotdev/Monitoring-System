// Whether the CONFIGURED server is reachable - distinct from the browser's
// own navigator.onLine/online-offline events (useOnlineStatus.ts), which
// only reflect whether this machine has some network interface up at all.
// A machine can be on a working Wi-Fi network while the specific office
// server is unreachable (wrong subnet, VPN down, server process crashed) -
// exactly the class of problem this whole conversation's earlier debugging
// (CORS, wrong LAN IP) was about, so "is the OS online" isn't good enough
// here.
import { useEffect, useRef, useState } from "react";
import { API_URL } from "../../api/http";
import { setKnownReachable } from "../../api/reachability";

const HEALTH_CHECK_INTERVAL_MS = 5_000;
const HEALTH_CHECK_TIMEOUT_MS = 2_000;

function healthUrl(): string {
  return new URL("/health", new URL(API_URL, window.location.href)).toString();
}

export async function checkServerReachable(): Promise<boolean> {
  if (typeof navigator !== "undefined" && !navigator.onLine) return false;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), HEALTH_CHECK_TIMEOUT_MS);
  try {
    const res = await fetch(healthUrl(), { signal: controller.signal, cache: "no-store" });
    return res.ok;
  } catch {
    return false;
  } finally {
    clearTimeout(timeout);
  }
}

/// Polls the configured server every 30s, plus immediately whenever the
/// browser's own online/offline status changes (a fast-path re-check rather
/// than waiting out the rest of the interval). `reconnects` bumps only on an
/// actual unreachable -> reachable transition, for the sync engine to react
/// to - not on every poll tick.
export function useServerConnectivity() {
  // Stay in offline mode until the configured server's health endpoint has
  // answered successfully. navigator.onLine alone cannot establish this.
  const [isReachable, setIsReachable] = useState(false);
  const [reconnects, setReconnects] = useState(0);
  const wasReachable = useRef(false);

  useEffect(() => {
    let cancelled = false;

    async function check() {
      const reachable = await checkServerReachable();
      if (cancelled) return;
      setIsReachable(reachable);
      setKnownReachable(reachable);
      if (reachable && !wasReachable.current) setReconnects((n) => n + 1);
      wasReachable.current = reachable;
    }

    check();
    const interval = setInterval(check, HEALTH_CHECK_INTERVAL_MS);
    window.addEventListener("online", check);
    window.addEventListener("offline", check);
    return () => {
      cancelled = true;
      clearInterval(interval);
      window.removeEventListener("online", check);
      window.removeEventListener("offline", check);
    };
  }, []);

  return { isReachable, reconnects };
}
