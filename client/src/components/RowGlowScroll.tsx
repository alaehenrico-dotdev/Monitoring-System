import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type FocusEvent as ReactFocusEvent,
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
 * ProductsAdminPage) - adds an animated gradient hover
 * border to whichever <tr> the pointer is currently over: two thin bars (top
 * edge, bottom edge only - no left/right sides, see .ae-row-ring in
 * index.css for why) rather than a full box outline.
 *
 * A <tr> has no single paintable box to draw a border on - it's a row of
 * separate <td> boxes - so rather than trying to fake it per-cell, this
 * component tracks whichever row is hovered in React state, measures its
 * actual rect, and renders two bar divs sized/positioned to match its top
 * and bottom edges.
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
    // ZoomControl.tsx applies CSS `zoom` to an ancestor of this container
    // (.ae-grid-fill), not to this container itself. getBoundingClientRect()
    // reports real on-screen pixels, already multiplied by that ancestor
    // zoom - but scrollEl.scrollTop/scrollLeft, and any inline top/left/width
    // we set below, stay in scrollEl's own zoom-unaware local pixel space
    // (they get multiplied by the zoom again once rendered). Mixing the two
    // unconverted is what let the ring/spotlight drift off the hovered row
    // at any zoom other than 100%. offsetWidth stays in that same local
    // space regardless of ancestor zoom, so comparing it against the
    // on-screen width gives the effective cumulative zoom factor to divide
    // the screen-pixel deltas by before they're used as local values.
    const zoomFactor = scrollEl.offsetWidth
      ? scrollRect.width / scrollEl.offsetWidth
      : 1;
    return {
      // Absolute children are positioned from the container's padding box,
      // i.e. inside its border - so the border width (clientTop/clientLeft)
      // comes off. Without it the ring/spotlight sat 1px too far right,
      // stuck out past the table's right edge and made a horizontal
      // scrollbar appear on a table that already fits.
      top:
        (rowRect.top - scrollRect.top) / zoomFactor -
        scrollEl.clientTop +
        scrollEl.scrollTop,
      left:
        (rowRect.left - scrollRect.left) / zoomFactor -
        scrollEl.clientLeft +
        scrollEl.scrollLeft,
      width: rowRect.width / zoomFactor,
      height: rowRect.height / zoomFactor,
    };
  }, []);

  const measure = useCallback(
    (row: Element | null) => setRing(rectOf(row)),
    [rectOf],
  );

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

  // Pins a persistent highlight on `row` (see focusRing above) - re-pinning
  // the same row (a different cell, to edit the next field) is a no-op
  // rather than re-measuring/re-persisting on every keystroke, since during
  // active encoding this fires on every cell focused, not just once. Passing
  // `null` (clicking the scroll container's own background, outside any
  // row) clears it.
  function pinRow(row: Element | null) {
    if (row === focusedRowRef.current) return;
    focusedRowRef.current = row;
    setFocusRing(rectOf(row));

    if (!focusStorageKey) return;
    try {
      const rowId = row?.getAttribute("data-row-id");
      if (rowId) sessionStorage.setItem(focusStorageKey, rowId);
      else sessionStorage.removeItem(focusStorageKey);
    } catch {
      // Best effort - a private window or blocked site data just means the
      // highlight doesn't survive navigation, not that clicking breaks.
    }
  }

  function handleClick(e: ReactMouseEvent<HTMLDivElement>) {
    const row = (e.target as Element).closest("tbody tr");
    pinRow(row);
  }

  // Keyboard-driven cell navigation (StockGrid's handleKeyDown moves focus
  // with a direct `.focus()` call via document.querySelector, not a click)
  // needs to pin the row it lands on too - this is the main way the focused
  // row actually changes while encoding, tabbing/arrowing cell to cell.
  // React's onFocus bubbles (unlike native DOM focus), so one listener here
  // catches a mouse click into a cell and a keyboard-driven focus change the
  // same way. Never clears the pin itself (no onBlur handler) - same as a
  // click, it stays pinned until a different row is focused or clicked.
  function handleFocus(e: ReactFocusEvent<HTMLDivElement>) {
    const row = (e.target as Element).closest("tbody tr");
    if (row) pinRow(row);
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
    const row = scrollEl.querySelector(
      `tbody tr[data-row-id="${CSS.escape(rowId)}"]`,
    );
    if (!row) return;
    focusedRowRef.current = row;
    setFocusRing(rectOf(row));
    // Deliberately mount/key-change only - re-running this on every
    // `rectOf` identity change (it's stable anyway) would fight the
    // ResizeObserver effect below for who gets the last word.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusStorageKey]);

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
      onMouseLeave={handleMouseLeave}
      onClick={handleClick}
      onFocus={handleFocus}
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
    </div>
  );
}
