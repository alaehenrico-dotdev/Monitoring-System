import type { CSSProperties } from "react";
import { useActivity, type ActivityState } from "../utils/activity";

const ANNOUNCE: Record<ActivityState, string> = {
  idle: "",
  // Saving and loading are routine: no announcement, only the beam.
  busy: "",
  slow: "Slow connection - still working",
  connecting: "Reconnecting to the server",
};

/**
 * The loading beam around the header seal: the same orbiting gold arc as the
 * app's loading spinner (.ae-logo-orbit), shown while the system is saving,
 * loading or connecting. Amber and slower when a request is taking long (slow
 * connection) or the live connection is (re)connecting.
 *
 * Sits absolutely over its parent, which must be `position: relative` and the
 * size of the seal; `size` is that size in px. Decorative: only the unusual
 * states (slow, reconnecting) are announced to a screen reader.
 */
export function ActivityBeam({ size }: { size: number }) {
  const state = useActivity();
  return (
    <span className={`ae-seal-beam is-${state}`} data-state={state} style={{ "--lp": `${size}px` } as CSSProperties}>
      <span className="ae-logo-orbit" aria-hidden="true">
        <span className="ae-logo-orbit-arc" />
        <span className="ae-logo-orbit-dot" />
      </span>
      <span role="status" className="ae-sr-only">
        {ANNOUNCE[state]}
      </span>
    </span>
  );
}
