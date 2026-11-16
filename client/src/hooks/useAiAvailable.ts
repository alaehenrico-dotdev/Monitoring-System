import { useEffect, useState } from "react";
import { getAiStatus } from "../api/ai";
import { useOptionalAuth } from "../context/AuthContext";

/// Asked once per page load and shared by everything that wants to know (the header icon and the
/// search palette). A failure is not kept, so the next mount tries again.
let enabledCache: Promise<boolean> | null = null;

export function loadAiEnabled(): Promise<boolean> {
  if (!enabledCache) {
    enabledCache = getAiStatus().then(
      (s) => s.enabled,
      () => {
        enabledCache = null;
        return false;
      },
    );
  }
  return enabledCache;
}

/// Exported for tests.
export function resetAiAvailableCache(): void {
  enabledCache = null;
}

/**
 * Whether the AI parts of the header search should show: a Supervisor/Admin (on the desktop or the
 * phone view), on a server that has AI set up. Everyone else never makes the request (the server
 * would refuse it) and sees the plain search exactly as before - same for a server with no key.
 */
export function useAiAvailable(): boolean {
  const role = useOptionalAuth()?.user?.role;
  const eligible = role === "SUPERVISOR_ADMIN";
  const [enabled, setEnabled] = useState(false);

  useEffect(() => {
    if (!eligible) return;
    let cancelled = false;
    void loadAiEnabled().then((on) => {
      if (!cancelled) setEnabled(on);
    });
    return () => {
      cancelled = true;
    };
  }, [eligible]);

  return eligible && enabled;
}
