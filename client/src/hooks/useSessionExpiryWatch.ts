import { useEffect, useState } from "react";
import { getToken } from "../api/http";
import { countAllUnsavedWork } from "../utils/unsavedWork";

const CHECK_MS = 30_000;
const WARN_BEFORE_MS = 5 * 60_000;

/// The token's own expiry (ms since epoch), read from its JWT payload. Null
/// when there's no token, it isn't a JWT, or it carries no `exp` - in which
/// case this feature simply stays quiet and the 401 handling still applies.
function tokenExpiryMs(): number | null {
  const token = getToken();
  const payload = token?.split(".")[1];
  if (!payload) return null;
  try {
    const json = JSON.parse(
      atob(payload.replace(/-/g, "+").replace(/_/g, "/")),
    ) as { exp?: unknown };
    return typeof json.exp === "number" ? json.exp * 1000 : null;
  } catch {
    return null;
  }
}

/**
 * Watches the session's expiry while there is unsaved work:
 *  - returns the minutes left once it is under five, so Layout can warn
 *    "save soon" before a save fails;
 *  - calls `onExpired` once the token is past its expiry, so the re-login
 *    dialog appears before the encoder's next Save is rejected.
 * Costs nothing when there's no unsaved work.
 */
export function useSessionExpiryWatch(
  active: boolean,
  onExpired: () => void,
): number | null {
  const [minutesLeft, setMinutesLeft] = useState<number | null>(null);

  useEffect(() => {
    if (!active) {
      setMinutesLeft(null);
      return;
    }
    function check() {
      const exp = tokenExpiryMs();
      if (exp === null || countAllUnsavedWork() === 0) {
        setMinutesLeft(null);
        return;
      }
      const remaining = exp - Date.now();
      if (remaining <= 0) {
        setMinutesLeft(null);
        onExpired();
      } else if (remaining <= WARN_BEFORE_MS) {
        setMinutesLeft(Math.max(1, Math.ceil(remaining / 60_000)));
      } else {
        setMinutesLeft(null);
      }
    }
    check();
    const timer = window.setInterval(check, CHECK_MS);
    return () => window.clearInterval(timer);
    // onExpired is stable (see AuthContext), listing it would only restart the timer.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active]);

  return minutesLeft;
}
