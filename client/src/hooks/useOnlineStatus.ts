import { useEffect, useRef, useState } from "react";
import { API_URL } from "../api/http";

const HEALTH_CHECK_INTERVAL_MS = 30_000;

async function checkServerReachable(): Promise<boolean> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 5_000);
  try {
    const url = new URL("/health", new URL(API_URL, window.location.href));
    const response = await fetch(url, { signal: controller.signal });
    return response.ok;
  } catch {
    return false;
  } finally {
    clearTimeout(timeout);
  }
}

/// Tracks reachability of the configured API, not just whether the device
/// has a network interface. Pages use reconnects to reload their current
/// data from the server after an offline period.
export function useOnlineStatus() {
  const [online, setOnline] = useState(() => (typeof navigator === "undefined" ? true : navigator.onLine));
  const [reconnects, setReconnects] = useState(0);
  const wasOnline = useRef(online);

  useEffect(() => {
    let cancelled = false;
    async function check() {
      const reachable = navigator.onLine && await checkServerReachable();
      if (cancelled) return;
      setOnline(reachable);
      if (reachable && !wasOnline.current) setReconnects((n) => n + 1);
      wasOnline.current = reachable;
    }
    void check();
    const interval = window.setInterval(() => void check(), HEALTH_CHECK_INTERVAL_MS);
    window.addEventListener("online", check);
    window.addEventListener("offline", check);
    return () => {
      cancelled = true;
      window.clearInterval(interval);
      window.removeEventListener("online", check);
      window.removeEventListener("offline", check);
    };
  }, []);

  return { online, reconnects };
}
