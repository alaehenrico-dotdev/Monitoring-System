import { useCallback, useEffect, useState } from "react";
import { getDayStatus, type DayClosure, type DayStatus } from "../api/ops";
import type { Shift } from "../types";

/**
 * Whether one date + shift has been finished/closed, so an entry page can show
 * it read-only instead of letting an encoder type into a sheet the server will
 * refuse. The server is still the authority (every write re-checks); this is
 * only so the refusal doesn't come as a surprise after the typing.
 *
 * Re-checked when the date/shift changes and on every realtime nudge, so a day
 * finished (or unlocked) on another device is reflected without a reload. A
 * failed lookup reports "not locked": better to let the save be refused with
 * the server's own message than to block editing on a status call.
 */
export function useDayLock(date: string, shift: Shift, refreshKey: unknown) {
  const [state, setState] = useState<{
    key: string;
    closure: DayClosure | null;
    locked: boolean;
    blockedBy: DayStatus["blockedBy"];
  } | null>(null);
  const key = `${date}:${shift}`;

  const load = useCallback(() => {
    let cancelled = false;
    getDayStatus(date, shift)
      .then((s) => {
        if (!cancelled) setState({ key, closure: s.closure, locked: s.isClosed, blockedBy: s.blockedBy ?? null });
      })
      .catch(() => {
        if (!cancelled) setState({ key, closure: null, locked: false, blockedBy: null });
      });
    return () => {
      cancelled = true;
    };
  }, [date, shift, key]);

  useEffect(load, [load, refreshKey]);

  // A status for another sheet must never be applied to this one.
  const current = state?.key === key ? state : null;
  return {
    loaded: current !== null,
    locked: current?.locked ?? false,
    closure: current?.closure ?? null,
    /// The earlier day to finish first (days are finished in order), if any.
    blockedBy: current?.blockedBy ?? null,
    /// Re-reads the status now - after this page's own Finish day.
    refresh: load,
  };
}
