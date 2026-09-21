import { createContext, useCallback, useContext, useMemo, useRef, useState, type ReactNode } from "react";
import { motionTokens } from "../theme";

interface ProgressState {
  percent: number;
  visible: boolean;
  failed: boolean;
  transitionMs: number;
}

export interface TopProgressApi {
  /// Marks one unit of work as started. Immediately shows the bar and eases
  /// it toward `motionTokens.progressHoldPercent` (90%) over several
  /// seconds - proof the app is actively working rather than frozen - and
  /// then just sits there until `done()`/`fail()` (or real `set()` calls)
  /// says otherwise. Never reaches 100% on its own; per the "no fake
  /// looping progress" rule, this only ever means "still going", not "this
  /// much is actually done".
  start: () => void;
  /// Completes the current unit of work: snaps to 100% and fades out.
  done: () => void;
  /// Same as `done()`, but tints the bar red first so a failed operation
  /// still resolves the bar instead of leaving it stuck.
  fail: () => void;
  /// Overrides the bar with a real, known percentage (e.g. "row 6 of 40
  /// imported") - once called, the synthetic ease-to-90% climb from
  /// `start()` is abandoned in favor of these real values.
  set: (percent: number) => void;
  /// Wraps a promise (or a synchronous function) with start()/done()/fail()
  /// automatically - the common case for an action with no real progress
  /// signal of its own (a PDF export, a data reset), where the ease-to-90%
  /// fallback is exactly what's wanted.
  track: <T>(fn: () => Promise<T> | T) => Promise<T>;
}

const INITIAL_STATE: ProgressState = { percent: 0, visible: false, failed: false, transitionMs: 0 };

const StateContext = createContext<ProgressState>(INITIAL_STATE);
const ApiContext = createContext<TopProgressApi | null>(null);

const HOLD_PERCENT = motionTokens.progressHoldPercent;
const CLIMB_MS = 8000; // slow, deliberate - the CSS engine (not JS) decelerates into this over several seconds
const SNAP_MS = 250; // fast finish once real work actually resolves
const FADE_MS = 300;

/**
 * Global determinate-progress-bar state (Section: Loading system). One
 * provider for the whole app (mounted in App.tsx) so any component -
 * PDF/CSV export, the database backup download, a future route-level
 * loader - can report into the same top-of-viewport bar instead of each
 * inventing its own. See TopProgressBar.tsx for the bar itself.
 *
 * Concurrency: an internal ref-counter means overlapping `start()` calls
 * (e.g. two exports fired back to back) keep the bar visible until every
 * one of them has called `done()`/`fail()`, rather than the first to finish
 * hiding it out from under the others.
 */
export function TopProgressProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<ProgressState>(INITIAL_STATE);
  const activeCount = useRef(0);
  const manual = useRef(false);
  const fadeTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const resetTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  const start = useCallback(() => {
    clearTimeout(fadeTimer.current);
    clearTimeout(resetTimer.current);
    activeCount.current += 1;
    if (activeCount.current !== 1) return; // already in flight - just extend it

    manual.current = false;
    setState({ percent: 0, visible: true, failed: false, transitionMs: 0 });
    // A separate frame so the "reset to 0" above never itself animates (that
    // would look like the bar sliding backwards) - only this climb does.
    requestAnimationFrame(() => {
      if (manual.current) return; // a real set() call already took over
      setState((s) => ({ ...s, percent: HOLD_PERCENT, transitionMs: CLIMB_MS }));
    });
  }, []);

  const finish = useCallback((failed: boolean) => {
    activeCount.current = Math.max(0, activeCount.current - 1);
    if (activeCount.current > 0) return; // other tracked work still in flight

    setState((s) => ({ ...s, percent: 100, failed, transitionMs: SNAP_MS }));
    fadeTimer.current = setTimeout(() => {
      setState((s) => ({ ...s, visible: false }));
      resetTimer.current = setTimeout(() => setState(INITIAL_STATE), FADE_MS);
    }, FADE_MS);
  }, []);

  const done = useCallback(() => finish(false), [finish]);
  const fail = useCallback(() => finish(true), [finish]);

  const set = useCallback((percent: number) => {
    manual.current = true;
    setState((s) => (s.visible ? { ...s, percent: Math.min(100, Math.max(0, percent)), transitionMs: 200 } : s));
  }, []);

  const track = useCallback(
    async <T,>(fn: () => Promise<T> | T): Promise<T> => {
      start();
      try {
        const result = await fn();
        done();
        return result;
      } catch (err) {
        fail();
        throw err;
      }
    },
    [start, done, fail],
  );

  // start/done/fail/set/track are each already stable across renders (every
  // useCallback above closes over only other stable callbacks or nothing at
  // all) - useMemo here just gives consumers a stable *object* identity too,
  // so context consumers don't re-render on every provider render for no
  // reason. (A previous version of this mutated a ref during render to get
  // the same effect - a real bug: React explicitly disallows reading/writing
  // ref.current mid-render.)
  const api = useMemo<TopProgressApi>(() => ({ start, done, fail, set, track }), [start, done, fail, set, track]);

  return (
    <ApiContext.Provider value={api}>
      <StateContext.Provider value={state}>{children}</StateContext.Provider>
    </ApiContext.Provider>
  );
}

export function useTopProgress(): TopProgressApi {
  const ctx = useContext(ApiContext);
  if (!ctx) throw new Error("useTopProgress must be used within a TopProgressProvider");
  return ctx;
}

export function useTopProgressState(): ProgressState {
  return useContext(StateContext);
}
