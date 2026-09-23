import { flushSync } from "react-dom";
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

  /**
   * Dark-mode switch as a circle that expands outward from this button
   * (not the click point - so it looks the same whether toggled by mouse,
   * touch, or keyboard) via the View Transition API. `toggleTheme` still
   * runs unconditionally on unsupported browsers or with reduced motion
   * requested - only the animation around it is skipped.
   */
  function handleToggle() {
    const prefersReducedMotion = window.matchMedia?.(
      "(prefers-reduced-motion: reduce)",
    ).matches;

    // Chrome/Edge only as of this writing - Safari/Firefox fall through to
    // the plain instant toggle, same as the reduced-motion guard above.
    if (!document.startViewTransition || prefersReducedMotion) {
      toggleTheme();
      return;
    }

    const rect = hostRef.current?.getBoundingClientRect();
    const x = rect ? rect.left + rect.width / 2 : window.innerWidth / 2;
    const y = rect ? rect.top + rect.height / 2 : window.innerHeight / 2;
    const endRadius = Math.hypot(
      Math.max(x, window.innerWidth - x),
      Math.max(y, window.innerHeight - y),
    );

    const transition = document.startViewTransition(() => {
      // Forces the theme's state + DOM update to land synchronously inside
      // this callback, so the browser's "after" snapshot is the new theme
      // rather than the old one (see ThemeContext's useLayoutEffect).
      flushSync(() => toggleTheme());
    });

    transition.ready.then(() => {
      document.documentElement.animate(
        {
          clipPath: [
            `circle(0px at ${x}px ${y}px)`,
            `circle(${endRadius}px at ${x}px ${y}px)`,
          ],
        },
        {
          duration: 550,
          easing: "ease-in-out",
          pseudoElement: "::view-transition-new(root)",
        },
      );
    });
  }

  return (
    <button
      ref={hostRef}
      type="button"
      onClick={handleToggle}
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