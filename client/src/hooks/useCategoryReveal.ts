import { useCallback, useEffect, useRef, useState } from "react";

/// How long a category's rows take to fade out before they are hidden. Rows fade
/// IN for the --ae-dur-enter (160ms) the stylesheet uses; the extra margin on the
/// clear timer below only makes sure the class outlives that animation.
export const CLOSE_MS = 140;
const OPEN_CLEAR_MS = 180;

type Phase = "opening" | "closing";

/// False where motion should not happen: the user asked the system to reduce it,
/// or there is no browser to ask (tests, server rendering).
function motionAllowed(): boolean {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") return false;
  return !window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

/**
 * A light fade for expanding and collapsing a table's category groups.
 *
 * Table rows cannot animate their height the way ordinary blocks do, and forcing
 * the browser to re-lay-out the whole table on every frame would be the heavy
 * way to fake it. So only opacity animates (cheap, and only on the rows of the
 * category that was clicked):
 *
 *   expand    the rows appear and fade in.
 *   collapse  the rows fade out first, THEN are hidden - so `apply` for a
 *             collapse runs ~140ms after the click. The caller's own state is
 *             therefore unchanged during the fade; use `closing()` to make
 *             anything that should answer the click at once (the chevron) do so.
 *
 * A second click during a fade-out cancels the collapse: the user changed their
 * mind, and the rows are still there. Nothing here changes what is expanded or
 * collapsed - `apply` does that, exactly as before - so with reduced motion (or
 * no browser) `apply` simply runs at once.
 */
export function useCategoryReveal() {
  const [phases, setPhases] = useState<Record<string, Phase>>({});
  const timers = useRef<Record<string, ReturnType<typeof setTimeout>>>({});

  const clear = useCallback((category: string) => {
    clearTimeout(timers.current[category]);
    delete timers.current[category];
    setPhases((p) => {
      if (!(category in p)) return p;
      const next = { ...p };
      delete next[category];
      return next;
    });
  }, []);

  useEffect(() => {
    const pending = timers.current;
    return () => {
      for (const t of Object.values(pending)) clearTimeout(t);
    };
  }, []);

  /// `wasExpanded`: whether the category shows its rows right now.
  /// `canCollapse`: false when something forces it open (unsaved edits), in which
  /// case there is nothing to fade out and `apply` just runs.
  const toggle = useCallback(
    (category: string, wasExpanded: boolean, canCollapse: boolean, apply: () => void) => {
      if (!motionAllowed() || (wasExpanded && !canCollapse)) {
        apply();
        return;
      }
      if (phases[category] === "closing") {
        // Clicked again mid fade-out: keep it open.
        clear(category);
        return;
      }
      clearTimeout(timers.current[category]);
      if (wasExpanded) {
        setPhases((p) => ({ ...p, [category]: "closing" }));
        timers.current[category] = setTimeout(() => {
          apply();
          clear(category);
        }, CLOSE_MS);
      } else {
        apply();
        setPhases((p) => ({ ...p, [category]: "opening" }));
        timers.current[category] = setTimeout(() => clear(category), OPEN_CLEAR_MS);
      }
    },
    [clear, phases],
  );

  return {
    toggle,
    /// True while the category's rows are fading out, before they are hidden.
    closing: (category: string) => phases[category] === "closing",
    /// The class (with a leading space) to add to each of the category's rows.
    rowClass: (category: string) =>
      phases[category] === "closing" ? " ae-row-closing" : phases[category] === "opening" ? " ae-row-opening" : "",
  };
}
