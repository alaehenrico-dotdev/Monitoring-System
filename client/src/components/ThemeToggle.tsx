import { useEffect, useRef } from "react";
import { flushSync } from "react-dom";
import { useTheme } from "../context/ThemeContext";
import { MoonIcon, SunIcon } from "./icons";

// Set on <html> only for the duration of a theme switch. index.css turns every
// CSS transition off while it is present (see the matching rule there): the
// theme change repaints the whole page at once, and letting dozens of
// per-element background/color transitions start on top of that - plus the
// View Transition's own snapshot - is what made toggling stutter. The short
// cross-fade (or the instant swap) is the only animation a theme switch has.
const SWITCHING_CLASS = "ae-theme-switching";

/**
 * Rendered inside TopBar.tsx, which owns the fixed top-right positioning so
 * this and LiveClock share one row - shows up identically on every route
 * since TopBar is rendered once at the app root (see App.tsx) rather than
 * per-page.
 */
export function ThemeToggle() {
  const { theme, toggleTheme } = useTheme();
  const isDark = theme === "dark";
  // The in-flight view transition, so a rapid second click can skip it
  // instead of stacking another full-page snapshot on top of it.
  const activeTransition = useRef<ReturnType<Document["startViewTransition"]> | null>(null);

  useEffect(
    () => () => document.documentElement.classList.remove(SWITCHING_CLASS),
    [],
  );

  /**
   * Dark-mode switch as a short cross-fade (the View Transition API's own, timed
   * in index.css). `toggleTheme` still runs unconditionally on unsupported
   * browsers or with reduced motion requested - only the fade is skipped.
   */
  function handleToggle() {
    const prefersReducedMotion = window.matchMedia?.(
      "(prefers-reduced-motion: reduce)",
    ).matches;

    const root = document.documentElement;
    root.classList.add(SWITCHING_CLASS);

    // Chrome/Edge only as of this writing - Safari/Firefox fall through to
    // the plain instant toggle, same as the reduced-motion guard above.
    if (!document.startViewTransition || prefersReducedMotion) {
      flushSync(() => toggleTheme());
      // Two frames: the first recalculates styles with transitions off, the
      // second is safe to re-enable them after.
      requestAnimationFrame(() =>
        requestAnimationFrame(() => root.classList.remove(SWITCHING_CLASS)),
      );
      return;
    }

    activeTransition.current?.skipTransition();

    const transition = document.startViewTransition(() => {
      // Forces the theme's state + DOM update to land synchronously inside
      // this callback, so the browser's "after" snapshot is the new theme
      // rather than the old one (see ThemeContext's useLayoutEffect).
      flushSync(() => toggleTheme());
    });
    activeTransition.current = transition;

    transition.finished
      .catch(() => {})
      .then(() => {
        // A skipped transition's `finished` fires while its replacement is
        // already running - only the latest one gets to end the switch.
        if (activeTransition.current !== transition) return;
        activeTransition.current = null;
        root.classList.remove(SWITCHING_CLASS);
      });
  }

  return (
    <button
      type="button"
      onClick={handleToggle}
      onMouseLeave={(e) => (e.currentTarget.style.transform = "scale(1)")}
      title={isDark ? "Switch to light mode" : "Switch to dark mode"}
      aria-label={isDark ? "Switch to light mode" : "Switch to dark mode"}
      className="ae-tap-target ae-round"
      style={{
        position: "relative",
        width: 36,
        height: 36,
        flexShrink: 0,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        borderRadius: "50%",
        border: "0.5px solid var(--ae-border)",
        background: "var(--ae-surface)",
        color: "var(--ae-text)",
        cursor: "pointer",
        boxShadow: "0 1px 4px rgba(12, 12, 12,0.15)",
        transition: "background-color 120ms ease, color 120ms ease, transform 120ms ease",
      }}
      onMouseDown={(e) => (e.currentTarget.style.transform = "scale(0.92)")}
      onMouseUp={(e) => (e.currentTarget.style.transform = "scale(1)")}
    >
      {isDark ? <SunIcon /> : <MoonIcon />}
    </button>
  );
}
