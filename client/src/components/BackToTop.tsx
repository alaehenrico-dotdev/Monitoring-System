import { useEffect, useRef, useState, type RefObject } from "react";
import { ArrowUpIcon } from "./icons";

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
export function BackToTop({ containerRef }: { containerRef: RefObject<HTMLElement> }) {
  const [visible, setVisible] = useState(false);
  const scrolledElRef = useRef<Element | null>(null);

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
      type="button"
      className="no-print ae-tap-target ae-round ae-backtotop"
      onClick={() => scrolledElRef.current?.scrollTo({ top: 0, behavior: "smooth" })}
      title="Back to top"
      aria-label="Back to top"
    >
      <ArrowUpIcon />
    </button>
  );
}