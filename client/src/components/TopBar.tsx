import { LiveClock } from "./LiveClock";
import { ThemeToggle } from "./ThemeToggle";

/**
 * Fixed to the top-right corner of the viewport (not a page element) so it
 * shows up identically on every route - rendered once at the app root (see
 * App.tsx) rather than per-page. The clock sits to the left of the toggle,
 * both in one row so they read as a single piece of persistent chrome.
 */
export function TopBar() {
  return (
    <div
      className="no-print"
      style={{
        position: "fixed",
        top: 16,
        right: 20,
        zIndex: 1000,
        display: "flex",
        alignItems: "center",
        gap: 10,
      }}
    >
      <LiveClock />
      <ThemeToggle />
    </div>
  );
}
