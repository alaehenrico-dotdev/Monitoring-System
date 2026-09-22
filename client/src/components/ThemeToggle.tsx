import { useTheme } from "../context/ThemeContext";
import { MoonIcon, SunIcon } from "./icons";
import { useCursorGlow, CursorGlowOverlay } from "./CursorGlow";

/**
 * Rendered inside TopBar.tsx, which owns the fixed top-right positioning so
 * this and LiveClock share one row - shows up identically on every route
 * since TopBar is rendered once at the app root (see App.tsx) rather than
 * per-page.
 *
 * Carries the same cursor-follow border sweep + interior spotlight as the
 * page toolbars (Toolbar.tsx) - see CursorGlow.tsx for the shared
 * mechanics.
 */
export function ThemeToggle() {
  const { theme, toggleTheme } = useTheme();
  const isDark = theme === "dark";
  const { hostRef, gradientRef, spotlightRef, handlePointerMove, handlePointerLeave } =
    useCursorGlow<HTMLButtonElement>();

  return (
    <button
      ref={hostRef}
      type="button"
      onClick={toggleTheme}
      onMouseMove={handlePointerMove}
      onMouseLeave={(e) => {
        handlePointerLeave();
        e.currentTarget.style.transform = "scale(1)";
      }}
      title={isDark ? "Switch to light mode" : "Switch to dark mode"}
      aria-label={isDark ? "Switch to light mode" : "Switch to dark mode"}
      className="ae-tap-target"
      style={{
        position: "relative",
        width: 36,
        height: 36,
        flexShrink: 0,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        borderRadius: "50%",
        // Transparent, same width as before - the visible ring is now
        // drawn by the CursorGlowOverlay below, so swapping it in never
        // shifts the button's size.
        border: "0.5px solid transparent",
        background: "var(--ae-surface)",
        color: "var(--ae-text)",
        cursor: "pointer",
        boxShadow: "0 1px 4px rgba(20,17,13,0.15)",
        transition: "background-color 120ms ease, color 120ms ease, transform 120ms ease",
      }}
      onMouseDown={(e) => (e.currentTarget.style.transform = "scale(0.92)")}
      onMouseUp={(e) => (e.currentTarget.style.transform = "scale(1)")}
    >
      <CursorGlowOverlay gradientRef={gradientRef} spotlightRef={spotlightRef} borderWidth={0.5} spotlightRadius={40} />
      {isDark ? <SunIcon /> : <MoonIcon />}
    </button>
  );
}