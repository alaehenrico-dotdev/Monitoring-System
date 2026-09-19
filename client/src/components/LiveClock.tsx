import { useEffect, useState } from "react";
import { colors } from "../theme";
import { useCursorGlow, CursorGlowOverlay } from "./CursorGlow";

/// A small live-updating clock pill - sits to the left of the dark-mode
/// toggle (see TopBar.tsx) so there's always a visible, always-current
/// reference for "what time is it right now" while working a shift,
/// without needing to check the OS clock.
///
/// Carries the same cursor-follow border sweep + interior spotlight as the
/// page toolbars (Toolbar.tsx) - see CursorGlow.tsx for the shared
/// mechanics.
export function LiveClock() {
  const [now, setNow] = useState(new Date());
  const { hostRef, gradientRef, spotlightRef, handlePointerMove, handlePointerLeave } =
    useCursorGlow<HTMLDivElement>();

  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(timer);
  }, []);

  return (
    <div
      ref={hostRef}
      onMouseMove={handlePointerMove}
      onMouseLeave={handlePointerLeave}
      className="no-print"
      style={{
        position: "relative",
        fontFamily: '"JetBrains Mono", "SF Mono", "Roboto Mono", ui-monospace, monospace',
        fontSize: 13,
        fontWeight: 600,
        fontVariantNumeric: "tabular-nums",
        letterSpacing: "-0.01em",
        color: colors.ink,
        background: colors.surface,
        // Transparent, same width as before - the visible ring is now
        // drawn by the CursorGlowOverlay below, so swapping it in never
        // shifts the pill's size.
        border: "0.5px solid transparent",
        borderRadius: 999,
        padding: "8px 14px",
        flexShrink: 0,
        boxShadow: "0 1px 4px rgba(20,17,13,0.1)",
      }}
    >
      <CursorGlowOverlay gradientRef={gradientRef} spotlightRef={spotlightRef} borderWidth={0.5} spotlightRadius={50} />
      {now.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit", second: "2-digit" })}
    </div>
  );
}