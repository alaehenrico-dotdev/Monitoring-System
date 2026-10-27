import { useEffect, useRef, useState, useSyncExternalStore } from "react";

/**
 * "Is the system busy?" for the loading beam around the header seal.
 *
 * Two things feed it: every API request (saving, loading, ... - api/http.ts wraps
 * each one) and the live connection to the server (RealtimeContext, while it is
 * connecting or reconnecting). The beam shows the resulting state:
 *
 *   idle        nothing is happening: no beam.
 *   busy        something is saving / loading.
 *   slow        a request has been waiting a long time: a slow connection.
 *   connecting  the live connection is (re)connecting.
 */
export type ActivityState = "idle" | "busy" | "slow" | "connecting";

interface Raw {
  /// Requests in flight right now.
  count: number;
  /// When the oldest of them started (ms), or null when none is in flight.
  oldest: number | null;
  connecting: boolean;
}

/// A request must run this long before the beam appears, so the many instant
/// ones never flash it.
export const SHOW_AFTER_MS = 250;
/// Once shown, the beam stays at least this long, so a request that ends just
/// after it appeared does not make it blink.
export const MIN_SHOW_MS = 700;
/// A single request waiting this long reads as a slow connection (the app's
/// own read timeout is 4 s).
export const SLOW_AFTER_MS = 3000;

let raw: Raw = { count: 0, oldest: null, connecting: false };
const started = new Map<number, number>();
let nextId = 1;
const listeners = new Set<() => void>();

function publish() {
  const oldest = started.size ? Math.min(...started.values()) : null;
  raw = { count: started.size, oldest, connecting: raw.connecting };
  for (const l of listeners) l();
}

/// Marks one request as started; call the returned function when it finishes
/// (success or failure). Safe to call twice.
export function beginActivity(): () => void {
  const id = nextId++;
  started.set(id, Date.now());
  publish();
  let ended = false;
  return () => {
    if (ended) return;
    ended = true;
    started.delete(id);
    publish();
  };
}

/// The live connection to the server is (re)connecting.
export function setConnecting(connecting: boolean) {
  if (raw.connecting === connecting) return;
  raw = { ...raw, connecting };
  for (const l of listeners) l();
}

function subscribeActivity(listener: () => void): () => void {
  listeners.add(listener);
  return () => void listeners.delete(listener);
}

export const getActivitySnapshot = (): Raw => raw;

/// What the beam should show for this raw state at time `now`, with no timing
/// smoothing (the hook adds that). Connecting wins, then slow, then busy.
export function resolveActivity(r: Raw, now: number): ActivityState {
  if (r.connecting) return "connecting";
  if (r.count > 0) return r.oldest !== null && now - r.oldest >= SLOW_AFTER_MS ? "slow" : "busy";
  return "idle";
}

/// Test hook: forget everything.
export function resetActivity() {
  started.clear();
  raw = { count: 0, oldest: null, connecting: false };
  for (const l of listeners) l();
}

/// The state to show, smoothed: nothing until the activity has lasted
/// SHOW_AFTER_MS, then at least MIN_SHOW_MS on screen, and "slow" once a request
/// has waited SLOW_AFTER_MS.
export function useActivity(): ActivityState {
  const snap = useSyncExternalStore(subscribeActivity, getActivitySnapshot, getActivitySnapshot);
  const [shown, setShown] = useState<ActivityState>("idle");
  const shownAt = useRef(0);

  useEffect(() => {
    const now = Date.now();
    const want = resolveActivity(snap, now);
    const timers: ReturnType<typeof setTimeout>[] = [];
    const show = (state: ActivityState) => {
      if (state !== "idle") shownAt.current = shownAt.current || Date.now();
      else shownAt.current = 0;
      setShown(state);
    };

    if (want === "idle") {
      if (shown === "idle") return;
      // Hide, but not before it has been up for MIN_SHOW_MS.
      const wait = Math.max(0, MIN_SHOW_MS - (now - shownAt.current));
      timers.push(setTimeout(() => show("idle"), wait));
    } else if (shown === "idle") {
      // Appear only if it is still going after SHOW_AFTER_MS.
      timers.push(setTimeout(() => show(resolveActivity(getActivitySnapshot(), Date.now())), SHOW_AFTER_MS));
    } else if (want !== shown) {
      show(want);
    }

    // A request that is just "busy" now turns "slow" when it has waited long enough.
    if (want === "busy" && snap.oldest !== null) {
      const untilSlow = SLOW_AFTER_MS - (now - snap.oldest);
      if (untilSlow > 0) timers.push(setTimeout(() => show(resolveActivity(getActivitySnapshot(), Date.now())), untilSlow));
    }
    return () => timers.forEach(clearTimeout);
  }, [snap, shown]);

  return shown;
}
