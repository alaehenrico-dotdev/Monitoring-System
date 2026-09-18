import { useEffect, useRef, useState, type RefObject } from "react";
import { ArrowUpIcon } from "./icons";
import { useCursorGlow, CursorGlowOverlay } from "./CursorGlow";

const SHOW_AFTER_PX = 400;

/// Floating button, bottom-right - appears once a page's scroll pane has
/// scrolled far enough that "just press Home/scroll up" stops being
/// convenient (a long Change Log day-list, a big Receipts history), and
/// scrolls it back to the top in one click.
///
/// Listens on `containerRef` (Layout.tsx's <main>) with `capture: true`
/// rather than tracking one fixed scrollable element - scroll events don't
/// bubble, but they do reach ancestors during the capture phase, so this
/// still sees a descendant's scroll. That's needed because most data pages
/// don't actually scroll `main` itself: their table sits in a bounded-height
/// wrapper (.ae-grid-fill/.ae-table-scroll, Section 3.1) that scrolls
/// internally instead, sticky header and all. Whichever element last
/// scrolled past the threshold is what gets scrolled back to top.
///
/// Carries the same cursor-follow border sweep + interior spotlight as the
/// page toolbars (Toolbar.tsx) - see CursorGlow.tsx for the shared
/// mechanics.
export function BackToTop({ containerRef }: { containerRef: RefObject<HTMLElement> }) {
  const [visible, setVisible] = useState(false);
  const scrolledElRef = useRef<Element | null>(null);
  const { hostRef, gradientRef, spotlightRef, handlePointerMove, handlePointerLeave } =
    useCursorGlow<HTMLButtonElement>();

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    function onScroll(e: Event) {
      const el = e.target;
      if (!(el instanceof Element)) return;
      if (el.scrollTop > SHOW_AFTER_PX) {
        scrolledElRef.current = el;
        setVisible(true);
      } else if (el === scrolledElRef.current) {
        setVisible(false);
      }
    }
    container.addEventListener("scroll", onScroll, { capture: true, passive: true });
    return () => container.removeEventListener("scroll", onScroll, true);
  }, [containerRef]);

  if (!visible) return null;

  return (
    <button
      ref={hostRef}
      type="button"
      className="no-print"
      onClick={() => scrolledElRef.current?.scrollTo({ top: 0, behavior: "smooth" })}
      onMouseMove={handlePointerMove}
      onMouseLeave={(e) => {
        handlePointerLeave();
        e.currentTarget.style.transform = "scale(1)";
      }}
      title="Back to top"
      aria-label="Back to top"
      style={{
        position: "fixed",
        bottom: 24,
        right: 24,
        zIndex: 900,
        width: 40,
        height: 40,
        borderRadius: "50%",
        // Transparent, same width as before - the visible ring is now
        // drawn by the CursorGlowOverlay below, so swapping it in never
        // shifts the button's size.
        border: "1px solid transparent",
        background: "var(--ae-surface)",
        color: "var(--ae-text)",
        cursor: "pointer",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        boxShadow: "0 2px 8px rgba(20,17,13,0.2)",
        transition: "background-color 120ms ease, transform 120ms ease",
      }}
      onMouseDown={(e) => (e.currentTarget.style.transform = "scale(0.92)")}
      onMouseUp={(e) => (e.currentTarget.style.transform = "scale(1)")}
    >
      <CursorGlowOverlay gradientRef={gradientRef} spotlightRef={spotlightRef} borderWidth={1} spotlightRadius={40} />
      <ArrowUpIcon />
    </button>
  );
}