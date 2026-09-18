import { useEffect, useRef, type MouseEvent as ReactMouseEvent, type RefObject } from "react";
import { colors } from "../theme";

/**
 * Same cursor-follow border-sweep + interior spotlight effect used by
 * Toolbar.tsx, generalized so any small element (a round button, a pill)
 * can opt in via `useCursorGlow()` + `<CursorGlowOverlay />` instead of
 * duplicating the keyframes/mask trick per component.
 *
 * Mechanics (identical to Toolbar.tsx's, see that file for the long-form
 * rationale): the host element gets a transparent border reserving space
 * for a ring; an absolutely-positioned overlay is padded by exactly that
 * border width, filled with a moving gold/cream gradient, then mask-
 * composited down to just the ring. At rest the gradient auto-sweeps; on
 * hover it recenters on the pointer (via `--mx`/`--my` custom properties
 * written directly to the DOM, not React state, so hovering never causes
 * a re-render). A second overlay - a soft white radial glow, blended with
 * `mixBlendMode: "screen"` - fades in under the cursor on the same
 * coordinates.
 */

const CURSOR_GLOW_STYLE_TAG_ID = "ae-cursor-glow-style";

const CURSOR_GLOW_STYLE = `
  @keyframes ae-cursor-glow-gradient-position {
    0%, 100% { background-position: 0% 50%; }
    50% { background-position: 100% 50%; }
  }
  .ae-cursor-glow-gradient-sweep {
    animation: ae-cursor-glow-gradient-position 13s linear infinite;
  }
  .ae-cursor-glow-gradient-sweep--tracking {
    animation-play-state: paused;
    background-position: var(--mx, 50%) var(--my, 50%);
  }
  .ae-cursor-glow-spotlight {
    opacity: var(--spotlight-opacity, 0);
    transition: opacity 220ms ease;
  }
`;

function useCursorGlowStyleTag() {
  useEffect(() => {
    if (document.getElementById(CURSOR_GLOW_STYLE_TAG_ID)) return;
    const style = document.createElement("style");
    style.id = CURSOR_GLOW_STYLE_TAG_ID;
    style.textContent = CURSOR_GLOW_STYLE;
    document.head.appendChild(style);
  }, []);
}

/**
 * `T` is the host element's own type (a `<div>` pill, a `<button>` circle,
 * etc.) so `hostRef`/`handlePointerMove` line up with whatever element you
 * attach them to.
 */
export function useCursorGlow<T extends HTMLElement = HTMLDivElement>() {
  useCursorGlowStyleTag();

  const hostRef = useRef<T>(null);
  const gradientRef = useRef<HTMLDivElement>(null);
  const spotlightRef = useRef<HTMLDivElement>(null);

  function handlePointerMove(e: ReactMouseEvent<T>) {
    const host = hostRef.current;
    if (!host) return;
    const rect = host.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return;
    const x = ((e.clientX - rect.left) / rect.width) * 100;
    const y = ((e.clientY - rect.top) / rect.height) * 100;
    host.style.setProperty("--mx", `${x}%`);
    host.style.setProperty("--my", `${y}%`);
    host.style.setProperty("--spotlight-opacity", "1");
    gradientRef.current?.classList.add("ae-cursor-glow-gradient-sweep--tracking");
  }

  function handlePointerLeave() {
    gradientRef.current?.classList.remove("ae-cursor-glow-gradient-sweep--tracking");
    hostRef.current?.style.setProperty("--spotlight-opacity", "0");
  }

  return { hostRef, gradientRef, spotlightRef, handlePointerMove, handlePointerLeave };
}

/**
 * The two overlay layers themselves. Render as the FIRST children of the
 * host element (so they paint behind real content, same ordering Toolbar.tsx
 * uses) - the host needs `position: relative` (or already be `fixed`/
 * `absolute`, which also establishes a positioning context) and a
 * transparent border matching `borderWidth`, so swapping the real border
 * for this ring never shifts layout.
 */
export function CursorGlowOverlay({
  gradientRef,
  spotlightRef,
  borderWidth = 1,
  spotlightRadius = 50,
}: {
  gradientRef: RefObject<HTMLDivElement>;
  spotlightRef: RefObject<HTMLDivElement>;
  borderWidth?: number;
  spotlightRadius?: number;
}) {
  return (
    <>
      <div
        ref={spotlightRef}
        aria-hidden
        className="ae-cursor-glow-spotlight"
        style={{
          position: "absolute",
          inset: 0,
          borderRadius: "inherit",
          pointerEvents: "none",
          mixBlendMode: "screen",
          background: `radial-gradient(circle ${spotlightRadius}px at var(--mx, 50%) var(--my, 50%), rgba(255,255,255,0.35), rgba(255,255,255,0.08) 55%, transparent 75%)`,
        }}
      />
      <div
        ref={gradientRef}
        aria-hidden
        className="ae-cursor-glow-gradient-sweep"
        style={{
          position: "absolute",
          inset: 0,
          borderRadius: "inherit",
          padding: borderWidth,
          pointerEvents: "none",
          backgroundImage: `linear-gradient(115deg, ${colors.black}, ${colors.yellow}, ${colors.black}, ${colors.gold}, ${colors.black}, ${colors.cream}, ${colors.black}, ${colors.gold}, ${colors.black}, ${colors.yellow}, ${colors.black})`,
          backgroundSize: "400% 400%",
          WebkitMask: "linear-gradient(#fff 0 0) content-box, linear-gradient(#fff 0 0)",
          WebkitMaskComposite: "xor",
          maskComposite: "exclude",
        }}
      />
    </>
  );
}