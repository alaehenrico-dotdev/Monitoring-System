import { useLayoutEffect, useRef, useState, type ReactNode } from "react";

const COMPACT_EXIT_BUFFER = 32;

/**
 * Card-style toolbar strip - the consistent home for a page's date/location
 * filters on one side and its action controls (CSV export/import, zoom) on
 * the other. Replaces a loose row of individually-bordered buttons floating
 * directly against the page background with one defined, bordered surface -
 * the same "toolbar" treatment used by every serious data-grid app.
 *
 * Also decides, exactly rather than by a guessed width breakpoint, whether
 * the toolbar's action buttons should fall back to icon-only: a hidden
 * clone of the same children is always rendered off-screen in full (never
 * compacted), and its natural one-line width is compared against how much
 * room the real toolbar actually has. Only when the real space is less
 * than that natural width does `.ae-toolbar--compact` get applied - so
 * labels never disappear "just in case", only when there's literally not
 * enough room for them.
 */
export function Toolbar({ children, className = "" }: { children: ReactNode; className?: string }) {
  const rowRef = useRef<HTMLDivElement>(null);
  const sizerRef = useRef<HTMLDivElement>(null);
  const compactRef = useRef(false);
  const frameRef = useRef<number | null>(null);
  const [compact, setCompact] = useState(false);

  useLayoutEffect(() => {
    const row = rowRef.current;
    const sizer = sizerRef.current;
    if (!row || !sizer) return;

    // useLayoutEffect (not useEffect) so this measure-and-correct happens
    // before the browser paints - if the full layout would have wrapped,
    // the user never sees that wrapped frame flash before it collapses to
    // icons.
    function measure() {
      if (!row || !sizer) return;
      const needed = sizer.getBoundingClientRect().width;
      const available = row.clientWidth;
      // Use hysteresis while the sidebar is animating: entering compact mode
      // happens as soon as space is tight, but leaving it waits for a clear
      // amount of spare room so the labels do not flicker at the threshold.
      const nextCompact = compactRef.current ? available < needed + COMPACT_EXIT_BUFFER : needed > available;
      if (nextCompact !== compactRef.current) {
        compactRef.current = nextCompact;
        setCompact(nextCompact);
      }
    }

    function scheduleMeasure() {
      if (frameRef.current !== null) return;
      frameRef.current = requestAnimationFrame(() => {
        frameRef.current = null;
        measure();
      });
    }

    measure();
    // Re-check whenever the real row's available width changes (sidebar
    // expand/collapse, window resize) or the hidden sizer's own natural
    // width changes (e.g. an "Importing…" status message is longer than
    // "Import").
    const ro = new ResizeObserver(scheduleMeasure);
    ro.observe(row);
    ro.observe(sizer);
    return () => {
      ro.disconnect();
      if (frameRef.current !== null) {
        cancelAnimationFrame(frameRef.current);
        frameRef.current = null;
      }
    };
  }, []);

  return (
    <>
      <div className={`ae-toolbar ${compact ? "ae-toolbar--compact" : ""} ${className}`.trim()} ref={rowRef}>
        {children}
      </div>
      {/* A sibling of the real row, not a child of it - critical, because
         .ae-toolbar--compact's rules (hide the label, shrink the search
         box, ...) are plain descendant selectors. Nesting the sizer inside
         the real row would mean that once the row picks up
         .ae-toolbar--compact, this "always full" clone gets compacted too,
         corrupting the very measurement that's supposed to represent the
         un-compacted natural width (and creating a compact<->not-compact
         feedback loop). Clipped to 0x0 so it never affects page layout or
         an ancestor's scrollable area - the sizer inside still lays out at
         its natural (shrink-to-fit, single-line) size, it just never
         paints or takes space. */}
      <div aria-hidden style={{ position: "absolute", width: 0, height: 0, overflow: "hidden" }}>
        <div
          ref={sizerRef}
          className="ae-toolbar"
          style={{ position: "absolute", visibility: "hidden", flexWrap: "nowrap", width: "max-content" }}
        >
          {children}
        </div>
      </div>
    </>
  );
}

/// Groups a page's action controls (CSV tools, zoom) so they sit together
/// with a shared gap, ready to be separated from each other by a ToolbarDivider.
export function ToolbarControls({ children }: { children: ReactNode }) {
  return <div className="ae-toolbar-controls">{children}</div>;
}

/// A thin vertical hairline between two control groups (e.g. CSV tools and
/// zoom) so they read as distinct clusters instead of one undifferentiated
/// row of buttons.
export function ToolbarDivider() {
  return <div className="ae-toolbar-divider" />;
}
