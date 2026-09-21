import { useTopProgressState } from "../hooks/useTopProgress";
import { colors, motionTokens } from "../theme";

/**
 * The determinate progress bar itself (Section: Loading system) - fixed to
 * the very top of the viewport so it reads the same way on every route,
 * above the Sidebar (z-index 50) and TopBar's clock/toggle (z-index 1000).
 * Purely presentational: all state lives in TopProgressProvider
 * (hooks/useTopProgress.tsx); this just renders it.
 *
 * `aria-hidden`: this bar is supplementary chrome, the same role a
 * browser's native tab-loading indicator plays - the actual ARIA semantics
 * for "this content is loading" belong to whichever region is loading (a
 * Skeleton's `role="status"`, or an action's own status text), not to this
 * bar. Duplicating `aria-live` here would announce every route change and
 * export twice over.
 */
export function TopProgressBar() {
  const { percent, visible, failed, transitionMs } = useTopProgressState();
  const tint = failed ? colors.danger : colors.yellow;

  return (
    <div aria-hidden="true" className={`no-print ae-top-progress-track${visible ? " is-visible" : ""}`}>
      <div
        className="ae-top-progress-bar"
        style={{
          transform: `scaleX(${percent / 100})`,
          transitionProperty: "transform",
          transitionDuration: `${transitionMs}ms`,
          transitionTimingFunction: motionTokens.progressEase,
          background: tint,
          color: tint,
        }}
      />
    </div>
  );
}
