import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type MouseEvent as ReactMouseEvent,
  type ReactNode,
} from "react";

interface RingRect {
  top: number;
  left: number;
  width: number;
  height: number;
}

// Must match .ae-row-ring's `height` in index.css - the bottom bar is
// pinned this far up from the row's own bottom edge so it sits flush
// against it instead of hanging half a row below.
const RING_THICKNESS = 1.5;

/**
 * Drop-in replacement for the plain `<div className="ae-table-scroll
 * table-scroll">` wrapper used by every data grid (StockGrid,
 * TotalStocksTable, ManualCountPage, ChangeLogPage, VarianceReportPage,
 * ProductsAdminPage, ReportHistoryTable) - adds an animated gradient hover
 * border to whichever <tr> the pointer is currently over: two thin bars (top
 * edge, bottom edge only - no left/right sides, see .ae-row-ring in
 * index.css for why) rather than a full box outline.
 *
 * A <tr> has no single paintable box to draw a border on - it's a row of
 * separate <td> boxes - so rather than trying to fake it per-cell, this
 * component tracks whichever row is hovered in React state, measures its
 * actual rect, and renders two bar divs sized/positioned to match its top
 * and bottom edges.
 *
 * A third div - the spotlight - rides along the same rect: a soft white
 * cursor-follow glow, the same effect used on the toolbar (Toolbar.tsx) and
 * sidebar tabs (Sidebar.tsx), recentered on the pointer via `--mx`/`--my` on
 * every mousemove so the hovered row itself feels lit from wherever the
 * cursor actually is, not just outlined.
 */
export function RowGlowScroll({
  children,
  className = "",
}: {
  children: ReactNode;
  className?: string;
}) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const lastRowRef = useRef<Element | null>(null);
  const spotlightRef = useRef<HTMLDivElement>(null);
  const [ring, setRing] = useState<RingRect | null>(null);

  const measure = useCallback((row: Element | null) => {
    const scrollEl = scrollRef.current;
    if (!scrollEl || !row) {
      setRing(null);
      return;
    }
    const scrollRect = scrollEl.getBoundingClientRect();
    const rowRect = row.getBoundingClientRect();
    // Content-coordinate space (this container's own scroll position baked
    // in), not viewport coordinates - that's what lets the ring live as a
    // normal absolutely-positioned child of this (position: relative,
    // overflow: auto - see .ae-table-scroll in index.css) container and
    // scroll together with the table for free, the same way any other
    // in-flow content would, rather than needing its own scroll listener
    // to stay lined up.
    setRing({
      top: rowRect.top - scrollRect.top + scrollEl.scrollTop,
      left: rowRect.left - scrollRect.left + scrollEl.scrollLeft,
      width: rowRect.width,
      height: rowRect.height,
    });
  }, []);

  function handleMouseOver(e: ReactMouseEvent<HTMLDivElement>) {
    const row = (e.target as Element).closest("tbody tr");
    // mouseover re-fires on every child element the pointer crosses while
    // moving around inside the same row (it bubbles, unlike mouseenter) -
    // skip the remeasure when it's still the same row, so a plain move
    // across cells doesn't churn state/layout reads on every pixel.
    if (row === lastRowRef.current) return;
    lastRowRef.current = row;
    measure(row);
  }

  function handleMouseLeave() {
    lastRowRef.current = null;
    setRing(null);
  }

  // Same cursor-follow trick as the toolbar/sidebar tabs (Toolbar.tsx,
  // Sidebar.tsx): write `--mx`/`--my` straight onto the spotlight div via
  // `style.setProperty` on every raw mousemove, rather than through React
  // state - state here would mean a re-render (and a re-measure of `ring`)
  // on every single pointer pixel, on top of the row-swap measurement
  // `handleMouseOver` already does. Reads `lastRowRef` (not `ring`) for the
  // row's rect, since `ring` is in content-coordinates for absolute
  // positioning while this needs plain viewport coordinates to compare
  // against `e.clientX/clientY`.
  function handleMouseMove(e: ReactMouseEvent<HTMLDivElement>) {
    const row = lastRowRef.current;
    const spotlight = spotlightRef.current;
    if (!row || !spotlight) return;
    const rect = row.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return;
    const x = ((e.clientX - rect.left) / rect.width) * 100;
    const y = ((e.clientY - rect.top) / rect.height) * 100;
    spotlight.style.setProperty("--mx", `${x}%`);
    spotlight.style.setProperty("--my", `${y}%`);
  }

  // The row currently under the ring can change size without any mouse
  // movement at all - committing an edit, a CSV import changing row
  // content, the window resizing. Re-measure whatever row is actually
  // under the pointer right now (":hover" works in querySelector too) so
  // the ring doesn't go stale and drift off the row it's meant to outline.
  useEffect(() => {
    if (!ring) return;
    let frame = 0;
    function reMeasure() {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        const scrollEl = scrollRef.current;
        if (!scrollEl) return;
        measure(scrollEl.querySelector("tbody tr:hover"));
      });
    }
    window.addEventListener("resize", reMeasure);
    return () => {
      window.removeEventListener("resize", reMeasure);
      cancelAnimationFrame(frame);
    };
  }, [ring, measure]);

  return (
    <div
      ref={scrollRef}
      className={`ae-table-scroll table-scroll ${className}`.trim()}
      onMouseOver={handleMouseOver}
      onMouseMove={handleMouseMove}
      onMouseLeave={handleMouseLeave}
    >
      {children}
      {ring && (
        <>
          <div
            aria-hidden
            className="ae-row-ring"
            style={{
              top: ring.top,
              left: ring.left,
              width: ring.width,
            }}
          />
          <div
            aria-hidden
            className="ae-row-ring"
            style={{
              top: ring.top + ring.height - RING_THICKNESS,
              left: ring.left,
              width: ring.width,
            }}
          />
          <div
            ref={spotlightRef}
            aria-hidden
            className="ae-row-spotlight"
            style={{
              top: ring.top,
              left: ring.left,
              width: ring.width,
              height: ring.height,
            }}
          />
        </>
      )}
    </div>
  );
}
