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
  focusStorageKey,
}: {
  children: ReactNode;
  className?: string;
  /**
   * Persists which row is click-focused (see `focusRing` below) to
   * sessionStorage, keyed by this string, and restores it on mount - so the
   * row someone was just editing is still marked when they navigate to a
   * different page and back, not just while the pointer stays put. Read off
   * each row's own `data-row-id` attribute (StockGrid sets this to the
   * product id), so the caller controls what actually counts as "the same
   * row" - typically scoped per date/shift, since row identity only means
   * anything against one specific loaded grid. Omit for a table with no
   * `data-row-id`s (or nothing worth restoring, e.g. a read-only report) to
   * get the old, session-only-in-memory behavior.
   */
  focusStorageKey?: string;
}) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const lastRowRef = useRef<Element | null>(null);
  const spotlightRef = useRef<HTMLDivElement>(null);
  const [ring, setRing] = useState<RingRect | null>(null);
  // The row last clicked - a persistent outline (as opposed to `ring`, which
  // only ever tracks whichever row the pointer happens to be hovering right
  // now) so a row someone just clicked into stays visibly marked after the
  // pointer moves away, e.g. to reach for the keyboard.
  const focusedRowRef = useRef<Element | null>(null);
  const [focusRing, setFocusRing] = useState<RingRect | null>(null);

  // Content-coordinate space (this container's own scroll position baked
  // in), not viewport coordinates - that's what lets a ring live as a normal
  // absolutely-positioned child of this (position: relative, overflow: auto -
  // see .ae-table-scroll in index.css) container and scroll together with
  // the table for free, the same way any other in-flow content would,
  // rather than needing its own scroll listener to stay lined up.
  const rectOf = useCallback((row: Element | null): RingRect | null => {
    const scrollEl = scrollRef.current;
    if (!scrollEl || !row) return null;
    const scrollRect = scrollEl.getBoundingClientRect();
    const rowRect = row.getBoundingClientRect();
    return {
      top: rowRect.top - scrollRect.top + scrollEl.scrollTop,
      left: rowRect.left - scrollRect.left + scrollEl.scrollLeft,
      width: rowRect.width,
      height: rowRect.height,
    };
  }, []);

  const measure = useCallback((row: Element | null) => setRing(rectOf(row)), [rectOf]);

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

  // Clicking a row pins a persistent outline on it (see focusRing above) -
  // clicking elsewhere in the same row (a different cell, to edit the next
  // field) just re-pins the same row rather than toggling it off, so the
  // outline doesn't flicker away mid-edit. Clicking outside any row (the
  // scroll container's own background) clears it.
  function handleClick(e: ReactMouseEvent<HTMLDivElement>) {
    const row = (e.target as Element).closest("tbody tr");
    focusedRowRef.current = row;
    setFocusRing(rectOf(row));

    if (!focusStorageKey) return;
    try {
      const rowId = row?.getAttribute("data-row-id");
      if (rowId) sessionStorage.setItem(focusStorageKey, rowId);
      else sessionStorage.removeItem(focusStorageKey);
    } catch {
      // Best effort - a private window or blocked site data just means the
      // outline doesn't survive navigation, not that clicking breaks.
    }
  }

  // Restores whatever row was focused last time, on mount and whenever
  // `focusStorageKey` itself changes (a different date/shift) - this is what
  // makes the outline survive navigating to a different page and back, since
  // that unmounts this component entirely and loses `focusRing`/
  // `focusedRowRef` otherwise. Only ever matches a row that's actually
  // rendered right now (via its `data-row-id`), so a stale id left over from
  // a product that's since been filtered/searched out, or removed, is
  // silently ignored rather than restoring a ring pointed at nothing.
  useEffect(() => {
    if (!focusStorageKey) return;
    const scrollEl = scrollRef.current;
    if (!scrollEl) return;
    let rowId: string | null;
    try {
      rowId = sessionStorage.getItem(focusStorageKey);
    } catch {
      rowId = null;
    }
    if (!rowId) return;
    const row = scrollEl.querySelector(`tbody tr[data-row-id="${CSS.escape(rowId)}"]`);
    if (!row) return;
    focusedRowRef.current = row;
    setFocusRing(rectOf(row));
    // Deliberately mount/key-change only - re-running this on every
    // `rectOf` identity change (it's stable anyway) would fight the
    // ResizeObserver effect below for who gets the last word.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusStorageKey]);

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

  // Same idea as the hover ring's re-measure above, but a ResizeObserver on
  // the scroll container itself rather than a window resize listener - the
  // focused row has to stay outlined long after the pointer has moved on
  // (that's the whole point of it being a click-pinned selection, not a
  // hover), including through layout changes a window resize would never
  // fire for, like the Excel-style zoom control (ZoomControl.tsx) rescaling
  // the table via CSS `zoom`.
  useEffect(() => {
    if (!focusRing) return;
    const scrollEl = scrollRef.current;
    if (!scrollEl) return;
    const observer = new ResizeObserver(() => {
      const row = focusedRowRef.current;
      // The row can be detached (e.g. a filter/search narrowed the table
      // out from under it) - drop the outline rather than leave it pinned
      // to a stale, invisible element.
      setFocusRing(row?.isConnected ? rectOf(row) : null);
    });
    observer.observe(scrollEl);
    return () => observer.disconnect();
  }, [focusRing, rectOf]);

  return (
    <div
      ref={scrollRef}
      className={`ae-table-scroll table-scroll ${className}`.trim()}
      onMouseOver={handleMouseOver}
      onMouseMove={handleMouseMove}
      onMouseLeave={handleMouseLeave}
      onClick={handleClick}
    >
      {children}
      {focusRing && (
        <div
          aria-hidden
          className="ae-row-focus"
          style={{
            top: focusRing.top,
            left: focusRing.left,
            width: focusRing.width,
            height: focusRing.height,
          }}
        />
      )}
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
