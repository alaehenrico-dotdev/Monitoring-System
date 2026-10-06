import { useEffect, useState } from "react";
import { colors } from "../theme";

/// A small live-updating clock pill - sits to the left of the dark-mode
/// toggle (see TopBar.tsx) so there's always a visible, always-current
/// reference for "what time is it right now" while working a shift,
/// without needing to check the OS clock.
export function LiveClock() {
  const [now, setNow] = useState(new Date());

  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(timer);
  }, []);

  return (
    <div
      className="no-print ae-live-clock"
      style={{
        position: "relative",
        fontFamily:
          '"JetBrains Mono", "SF Mono", "Roboto Mono", ui-monospace, monospace',
        fontSize: 13,
        fontWeight: 600,
        fontVariantNumeric: "tabular-nums",
        letterSpacing: "-0.01em",
        color: colors.ink,
        background: colors.surface,
        border: "0.5px solid var(--ae-border)",
        borderRadius: 6,
        padding: "8px 14px",
        flexShrink: 0,
        boxShadow: "0 1px 4px rgba(12, 12, 12,0.1)",
      }}
    >
      {now.toLocaleTimeString(undefined, {
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
      })}
    </div>
  );
}
