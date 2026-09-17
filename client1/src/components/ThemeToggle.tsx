import { useTheme } from "../context/ThemeContext";
import { MoonIcon, SunIcon } from "./icons";

/**
 * Rendered inside TopBar.tsx, which owns the fixed top-right positioning so
 * this and LiveClock share one row - shows up identically on every route
 * since TopBar is rendered once at the app root (see App.tsx) rather than
 * per-page.
 */
export function ThemeToggle() {
  const { theme, toggleTheme } = useTheme();
  const isDark = theme === "dark";

  return (
    <button
      type="button"
      onClick={toggleTheme}
      title={isDark ? "Switch to light mode" : "Switch to dark mode"}
      aria-label={isDark ? "Switch to light mode" : "Switch to dark mode"}
      style={{
        width: 36,
        height: 36,
        flexShrink: 0,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        borderRadius: "50%",
        border: "1px solid var(--ae-border)",
        background: "var(--ae-surface)",
        color: "var(--ae-text)",
        cursor: "pointer",
        boxShadow: "0 1px 4px rgba(20,17,13,0.15)",
        transition: "background-color 120ms ease, color 120ms ease, transform 120ms ease",
      }}
      onMouseDown={(e) => (e.currentTarget.style.transform = "scale(0.92)")}
      onMouseUp={(e) => (e.currentTarget.style.transform = "scale(1)")}
      onMouseLeave={(e) => (e.currentTarget.style.transform = "scale(1)")}
    >
      {isDark ? <SunIcon /> : <MoonIcon />}
    </button>
  );
}
