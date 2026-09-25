import { LiveClock } from "./LiveClock";
import { ThemeToggle } from "./ThemeToggle";

/// Clock + dark-mode toggle, anchored to the top-right corner of a page's
/// <div className="ae-page-header"> card (which is `position: relative`
/// precisely for this) rather than sitting among that page's own toolbar
/// controls - it's app-wide chrome, not a control for whatever this
/// particular page does. Previously these lived only in the app-root TopBar
/// (see TopBar.tsx); TopBar is now shown on the login screen only, and
/// before that this rendered inline at the end of <ToolbarControls>.
///
/// Renders as the first child of the header card (order doesn't matter -
/// absolute positioning takes it out of flow), never inside <Toolbar>/
/// <ToolbarControls> - no <ToolbarDivider /> needed alongside it any more.
export function HeaderExtras() {
  return (
    <span
      className="no-print"
      style={{
        position: "absolute",
        top: 10,
        right: 14,
        display: "flex",
        alignItems: "center",
        gap: 10,
      }}
    >
      <LiveClock />
      <ThemeToggle />
    </span>
  );
}
