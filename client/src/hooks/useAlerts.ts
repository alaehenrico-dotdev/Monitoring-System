import { useCallback, useEffect, useRef, useState } from "react";
import { getAlerts, type Alerts } from "../api/alerts";
import { useOptionalAuth } from "../context/AuthContext";
import { currentMode, resyncNotifications, showLocalNotification } from "../utils/pushNotifications";

const POLL_MS = 2 * 60 * 1000;

/// The admin's alert list, refreshed every couple of minutes and when the tab is shown again.
/// When this device uses open-app notifications, a problem that appears after the first load
/// is also announced with a notification. Null for anyone who is not a Supervisor/Admin.
export function useAlerts(): { alerts: Alerts | null; refresh: () => void } | null {
  const eligible = useOptionalAuth()?.user?.role === "SUPERVISOR_ADMIN";
  const [alerts, setAlerts] = useState<Alerts | null>(null);
  const announced = useRef<Set<string> | null>(null);

  const load = useCallback(async () => {
    try {
      const next = await getAlerts();
      setAlerts(next);
      const urgent = next.items.filter((i) => i.severity === "high");
      const before = announced.current;
      announced.current = new Set(urgent.map((i) => i.id));
      if (before && currentMode() === "local") {
        const fresh = urgent.filter((i) => !before.has(i.id));
        if (fresh.length) {
          void showLocalNotification(
            fresh.length === 1 ? "Needs attention" : `${fresh.length} things need attention`,
            fresh.slice(0, 3).map((i) => i.title).join("; "),
            fresh.length === 1 ? fresh[0].link : "/admin-queue",
          );
        }
      }
    } catch {
      /* offline or the server is restarting: the next poll tries again */
    }
  }, []);

  useEffect(() => {
    if (!eligible) return;
    const first = setTimeout(() => void load(), 0);
    // Re-registers this device if the server dropped it (see resyncNotifications).
    void resyncNotifications();
    // A tab in the background does not poll: it refreshes the moment it is shown again (below).
    const timer = setInterval(() => document.visibilityState === "visible" && void load(), POLL_MS);
    const onVisible = () => document.visibilityState === "visible" && void load();
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      clearTimeout(first);
      clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [eligible, load]);

  return eligible ? { alerts, refresh: () => void load() } : null;
}
