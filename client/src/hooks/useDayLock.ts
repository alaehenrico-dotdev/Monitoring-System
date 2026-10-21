import { useCallback, useEffect, useState } from "react";
import { getDayStatus, type DayClosure, type DayStatus, type EntryLocation } from "../api/ops";
import type { Shift } from "../types";

/**
 * Whether one entry page (Online or Offline) of a date + shift has been
 * finished/closed - each page is finished on its own, so the other page being
 * finished does not lock this one - so an entry page can show
 * it read-only instead of letting an encoder type into a sheet the server will
 * refuse. The server is still the authority (every write re-checks); this is
 * only so the refusal doesn't come as a surprise after the typing.
 *
 * Re-checked when the date/shift changes and on every realtime nudge, so a day
 * finished (or unlocked) on another device is reflected without a reload. A
 * failed lookup reports "not locked": better to let the save be refused with
 * the server's own message than to block editing on a status call.
 */
export function useDayLock(date: string, shift: Shift, refreshKey: unknown, location: EntryLocation) {
  const [state, setState] = useState<{
    key: string;
    closure: DayClosure | null;
    locked: boolean;
    blockedBy: DayStatus["blockedBy"];
    entryBlockedBy: DayStatus["blockedBy"];
  } | null>(null);
  const key = `${date}:${shift}:${location}`;

  const load = useCallback(() => {
    let cancelled = false;
    getDayStatus(date, shift, location)
      .then((s) => {
        if (!cancelled) {
          const blockedBy = s.blockedBy ?? null;
          // A server without entry rules sends no entryBlockedBy: entering is
          // then blocked by the same day as finishing, as it always was.
          setState({ key, closure: s.closure, locked: s.locked, blockedBy, entryBlockedBy: s.entryBlockedBy === undefined ? blockedBy : s.entryBlockedBy });
        }
      })
      .catch(() => {
        if (!cancelled) setState({ key, closure: null, locked: false, blockedBy: null, entryBlockedBy: null });
      });
    return () => {
      cancelled = true;
    };
  }, [date, shift, location, key]);

  useEffect(load, [load, refreshKey]);

  // A status for another sheet must never be applied to this one.
  const current = state?.key === key ? state : null;
  return {
    loaded: current !== null,
    locked: current?.locked ?? false,
    closure: current?.closure ?? null,
    /// The earlier day to finish first before THIS day can be finished (locks
    /// stay in order), if any.
    blockedBy: current?.blockedBy ?? null,
    /// The earlier day to finish first before this sheet can be ENTERED - null
    /// when the entry rules let people enter ahead of it.
    entryBlockedBy: current?.entryBlockedBy ?? null,
    /// Re-reads the status now - after this page's own Finish day.
    refresh: load,
  };
}
