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

/**
 * Drop-in replacement for the plain `<div className="ae-table-scroll
 * table-scroll">` wrapper used by every data grid (StockGrid,
 * TotalStocksTable, ManualCountPage, ChangeLogPage, VarianceReportPage,
 * ProductsAdminPage, ReportHistoryTable) - adds a single animated
 * gradient-border ring around whichever <tr> the pointer is currently
 * over, using the exact same padding + mask-composite technique as the
 * expanded sidebar's own border ring (Sidebar.tsx's
 * .ae-sidebar-gradient-sweep; the ring's look lives in index.css as
 * .ae-row-ring / @keyframes ae-row-ring-sweep).
 *
 * That technique only works on a single paintable box, and a <tr> isn't
 * one - it's a row of separate <td> boxes with nothing to wrap and mask as
 * a unit. So rather than trying to fake it per-cell, this component tracks
 * whichever row is hovered in React state, measures its actual rect, and
 * renders exactly one ring div sized/positioned to match it - a true
 * single border around the whole row.
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
      onMouseLeave={handleMouseLeave}
    >
      {children}
      {ring && (
        <div
          aria-hidden
          className="ae-row-ring"
          style={{
            top: ring.top,
            left: ring.left,
            width: ring.width,
            height: ring.height,
          }}
        />
      )}
    </div>
  );
}
