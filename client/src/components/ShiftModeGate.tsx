import { useEffect, useRef, useState } from "react";
import { Outlet } from "react-router-dom";
import { getShiftMode } from "../api/appSettings";
import { useRealtimeVersion } from "../context/RealtimeContext";
import { LoadingBlock } from "./Spinner";
import { setWholeDayMode } from "../utils/shift";

/**
 * Loads Settings > Entry Rules > shifts before any page renders, so every page's
 * first "what is the current shift and date" already follows it. Until it has
 * loaded nothing is shown; if it cannot be read the app runs with shifts on,
 * the long-standing behaviour.
 *
 * A change made while the app is open (an admin flipping the switch, seen by
 * everyone else on the next realtime tick) reloads the page: a sheet half
 * filled in under one mode must not carry on under the other. Staged edits are
 * kept by the entry pages, so nothing typed is lost to the reload.
 */
export function ShiftModeGate() {
  const [ready, setReady] = useState(false);
  const known = useRef<boolean | null>(null);
  const realtimeVersion = useRealtimeVersion();

  useEffect(() => {
    let cancelled = false;
    getShiftMode()
      .then(({ useShifts }) => {
        if (cancelled) return;
        if (known.current !== null && known.current !== useShifts) {
          window.location.reload();
          return;
        }
        known.current = useShifts;
        setWholeDayMode(!useShifts);
        setReady(true);
      })
      .catch(() => {
        if (cancelled) return;
        // Keep whatever was last known; first load falls back to shifts on.
        if (known.current === null) {
          known.current = true;
          setWholeDayMode(false);
        }
        setReady(true);
      });
    return () => {
      cancelled = true;
    };
  }, [realtimeVersion]);

  if (!ready) return <LoadingBlock label="" minHeight="var(--ae-vh)" size="xxl" />;
  return <Outlet />;
}
