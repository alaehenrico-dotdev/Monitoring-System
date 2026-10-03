import { lazy, Suspense } from "react";
import { LiveClock } from "./LiveClock";
import { ThemeToggle } from "./ThemeToggle";

// Desktop app only - lazy + mode-gated like Layout.tsx's OfflineSyncBadge, so
// the web build never emits this chunk.
const SyncButton = lazy(() => import("../tauri/SyncButton"));
const isTauri = import.meta.env.MODE === "tauri";

/// Clock + (desktop app) sync button + dark-mode toggle, sitting at the right end of the header's title
/// row (PageHeader.tsx) so they're vertically centered on the h2, rather than sitting among that page's own toolbar
/// controls - it's app-wide chrome, not a control for whatever this
/// particular page does. Previously these lived only in the app-root TopBar
/// (see TopBar.tsx); TopBar is now shown on the login screen only, and
/// before that this rendered inline at the end of <ToolbarControls>.
///
/// Renders inside the header's title row, never inside <Toolbar>/
/// <ToolbarControls> - no <ToolbarDivider /> needed alongside it any more.
export function HeaderExtras() {
  return (
    <span
      className="no-print ae-page-header-extras"
      style={{
        display: "flex",
        alignItems: "center",
        gap: 10,
        flexShrink: 0,
      }}
    >
      <LiveClock />
      {isTauri && (
        <Suspense
          fallback={<span style={{ width: 36, height: 36, flexShrink: 0 }} />}
        >
          <SyncButton />
        </Suspense>
      )}
      <ThemeToggle />
    </span>
  );
}
