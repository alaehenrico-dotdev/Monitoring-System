import { LiveClock } from "./LiveClock";
import { openQuickJump } from "./QuickJump";
import { AiSearchIcon, SearchIcon } from "./icons";
import { ThemeToggle } from "./ThemeToggle";
import { TypingPractice } from "./TypingPractice";
import { useReadOnlyPhone } from "../hooks/useReadOnlyPhone";
import { useAiAvailable } from "../hooks/useAiAvailable";

/// Clock + dark-mode toggle, sitting at the right end of the header's title
/// row (PageHeader.tsx) so they're vertically centered on the h2, rather than sitting among that page's own toolbar
/// controls - it's app-wide chrome, not a control for whatever this
/// particular page does. Previously these lived only in the app-root TopBar
/// (see TopBar.tsx); TopBar is now shown on the login screen only, and
/// before that this rendered inline at the end of <ToolbarControls>.
///
/// Renders inside the header's title row, never inside <Toolbar>/
/// <ToolbarControls> - no <ToolbarDivider /> needed alongside it any more.
export function HeaderExtras() {
  // Typing practice is a keyboard exercise: desktop only, never on the phone view.
  const phone = useReadOnlyPhone();
  // Supervisor/Admin on a server with an AI key: the same button, AI-styled, and the palette it opens
  // also takes questions. Everyone else gets the plain search icon.
  const ai = useAiAvailable();
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
      {/* Pointer-reachable twin of Ctrl+K (QuickJump.tsx). The shortcut is
          the fast path; this is what makes the feature discoverable at all. */}
      <button
        type="button"
        className={ai ? "ae-header-search-btn ae-header-search-btn--ai" : "ae-header-search-btn"}
        onClick={openQuickJump}
        aria-label={ai ? "Search pages and products, or ask AI (Ctrl+K)" : "Quick jump to a page or product (Ctrl+K)"}
        title={ai ? "Search, or ask AI a question (Ctrl+K)" : "Jump to a page or product (Ctrl+K)"}
      >
        {ai ? <AiSearchIcon /> : <SearchIcon />}
      </button>
      {!phone && <TypingPractice />}
      <LiveClock />
      <ThemeToggle />
    </span>
  );
}
