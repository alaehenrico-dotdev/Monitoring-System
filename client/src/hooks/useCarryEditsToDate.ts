import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Shift } from "../types";

const BASELINE_PREFIX = "ala-eh-baseline:";

/// Moves the staged edits stored under one sheet key to another (the new sheet's own staged edits
/// stay; on the same cell the moved value wins). Baselines are dropped: they describe the old
/// date's saved values, and an edit with no baseline is simply never flagged as a conflict.
export function moveStagedEdits(fromKey: string, toKey: string): void {
  try {
    const moved = JSON.parse(sessionStorage.getItem(fromKey) ?? "{}") as Record<string, Record<string, number>>;
    const existing = JSON.parse(sessionStorage.getItem(toKey) ?? "{}") as Record<string, Record<string, number>>;
    const merged = { ...existing };
    for (const [pid, cols] of Object.entries(moved)) merged[pid] = { ...(merged[pid] ?? {}), ...cols };
    sessionStorage.setItem(toKey, JSON.stringify(merged));
    sessionStorage.removeItem(fromKey);
    sessionStorage.removeItem(BASELINE_PREFIX + fromKey);
    sessionStorage.removeItem(BASELINE_PREFIX + toKey);
  } catch {
    // Best effort - without storage the edits just stay with the old date.
  }
}

/**
 * The Save review's "Change date": the staged edits follow the newly picked date instead of staying
 * behind on the old one, and the Save review reopens there once that sheet has loaded. Only armed
 * by that button - a click anywhere outside the date picker disarms it, so an ordinary date change
 * later never carries edits along.
 */
export function useCarryEditsToDate({
  storagePrefix,
  date,
  shift,
  setDate,
  loaded,
  hasPending,
  openReview,
}: {
  /// e.g. "ala-eh-pending:online" - the key is `${storagePrefix}:${date}:${shift}`.
  storagePrefix: string;
  date: string;
  shift: Shift;
  setDate: (d: string) => void;
  loaded: boolean;
  hasPending: boolean;
  openReview: () => void;
}) {
  const [armed, setArmed] = useState(false);
  const [reopen, setReopen] = useState(false);
  const from = useRef({ date, shift });
  // Latest callback without making the effects below re-run on every render of the page.
  const openRef = useRef(openReview);
  // Refs are written after render, not during it. This effect is declared first, so it has run before
  // the ones below read the refs, and before any click handler does.
  useEffect(() => {
    from.current = { date, shift };
    openRef.current = openReview;
  });

  useEffect(() => {
    if (!armed) return;
    function onClick(e: MouseEvent) {
      const t = e.target as Element | null;
      if (!t?.closest?.(".ae-datestep, .ae-datepicker")) setArmed(false);
    }
    document.addEventListener("click", onClick, true);
    return () => document.removeEventListener("click", onClick, true);
  }, [armed]);

  useEffect(() => {
    if (reopen && loaded && hasPending) {
      setReopen(false);
      openRef.current();
    }
  }, [reopen, loaded, hasPending]);

  const changeDate = useCallback(
    (d: string) => {
      if (armed && d !== from.current.date) {
        const { date: fd, shift: fs } = from.current;
        moveStagedEdits(`${storagePrefix}:${fd}:${fs}`, `${storagePrefix}:${d}:${fs}`);
        setReopen(true);
      }
      setArmed(false);
      setDate(d);
    },
    [armed, storagePrefix, setDate],
  );

  const arm = useCallback(() => setArmed(true), []);
  return useMemo(() => ({ arm, changeDate }), [arm, changeDate]);
}
