import {
  createContext,
  useContext,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";

// Hysteresis buffers: how much *extra* spare room is required before
// stepping back up a tier (circle <- compact <- full). Without this, a
// row sitting exactly at a breakpoint flickers between tiers on every
// sub-pixel resize/animation frame.
const COMPACT_EXIT_BUFFER = 24;
const CIRCLE_EXIT_BUFFER = 16;

// Safety margin (px) added to every measured "needed" width. offsetWidth is
// rounded to a whole pixel while the clones measure fractional widths, so
// without this a row that "just fits" can end up ~1px too narrow and overflow.
const FIT_SLACK = 2;

// Three tiers: controls shed their labels (compact), then their rectangular
// shape (circle). Full and compact stay on one line. The smallest tier (circle)
// wraps onto a second row - filters on the first, actions on the second -
// instead of scrolling sideways out of sight (see index.css).
type ToolbarMode = "full" | "compact" | "circle";

// Lets descendants know which tier they are being rendered in. The hidden
// measuring clones below each pin their own tier through this context.
const ToolbarModeContext = createContext<ToolbarMode>("full");

/**
 * Card-style toolbar strip - the consistent home for a page's date/location
 * filters on one side and its action controls (CSV export/import, PDF, zoom)
 * on the other.
 *
 * Nothing here animates: the toolbar answers the window's size, so it takes
 * its new shape at once instead of morphing, which squashed buttons mid-resize.
 *
 * Responsiveness is a three-tier ladder, measured exactly rather than
 * guessed from a width breakpoint:
 *
 *   full     Filters and action buttons (with labels) side by side.
 *   compact  Action buttons drop their labels (`.ae-toolbar--compact`).
 *   circle   Fixed-size icon buttons, wrapping to two rows (`.ae-toolbar--circle`).
 *
 * Three hidden clones of the children (one per tier) are measured at their
 * natural width and compared with the real row's width, so a tier only
 * activates when there is literally not enough room for the tier above it.
 * Within a tier the search box / selects / date pickers are elastic in
 * CSS, so any leftover room is absorbed by the filters - no blank gap.
 */
export function Toolbar({
  children,
  className = "",
}: {
  children: ReactNode;
  className?: string;
}) {
  const rowRef = useRef<HTMLDivElement>(null);
  const fullSizerRef = useRef<HTMLDivElement>(null);
  const compactSizerRef = useRef<HTMLDivElement>(null);
  const circleSizerRef = useRef<HTMLDivElement>(null);
  const modeRef = useRef<ToolbarMode>("full");
  const frameRef = useRef<number | null>(null);
  const [mode, setMode] = useState<ToolbarMode>("full");

  useLayoutEffect(() => {
    const row = rowRef.current;
    const fullSizer = fullSizerRef.current;
    const compactSizer = compactSizerRef.current;
    const circleSizer = circleSizerRef.current;
    if (!row || !fullSizer || !compactSizer || !circleSizer) return;

    // useLayoutEffect (not useEffect) so this measure-and-correct happens
    // before the browser paints - the user never sees a broken frame.
    function measure() {
      if (!row || !fullSizer || !compactSizer || !circleSizer) return;

      // offsetWidth (border-box, layout width) for the real row: unlike
      // getBoundingClientRect it ignores the transform Framer Motion applies
      // while a layout animation is running. The sizers are `.ae-toolbar`
      // too, so their border-box width is directly comparable.
      const available = row.offsetWidth;
      const fullNeeded =
        Math.ceil(fullSizer.getBoundingClientRect().width) + FIT_SLACK;
      const compactNeeded =
        Math.ceil(compactSizer.getBoundingClientRect().width) + FIT_SLACK;

      // Hysteresis per edge, evaluated relative to the CURRENT tier, so a
      // width sitting right at a boundary settles into one state instead
      // of oscillating. "circle" is the floor - its only branch is "is
      // there now enough room to promote back up".
      let next: ToolbarMode;
      switch (modeRef.current) {
        case "circle":
          next =
            available >= compactNeeded + CIRCLE_EXIT_BUFFER
              ? available >= fullNeeded
                ? "full"
                : "compact"
              : "circle";
          break;
        case "compact":
          next =
            available < compactNeeded
              ? "circle"
              : available >= fullNeeded + COMPACT_EXIT_BUFFER
                ? "full"
                : "compact";
          break;
        case "full":
        default:
          next =
            available >= fullNeeded
              ? "full"
              : available >= compactNeeded
                ? "compact"
                : "circle";
          break;
      }

      if (next !== modeRef.current) {
        modeRef.current = next;
        setMode(next);
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
    // expand/collapse, window resize) or any sizer's own natural width
    // changes (e.g. an "Importing…" label is longer than "Import").
    const ro = new ResizeObserver(scheduleMeasure);
    ro.observe(row);
    ro.observe(fullSizer);
    ro.observe(compactSizer);
    ro.observe(circleSizer);
    return () => {
      ro.disconnect();
      if (frameRef.current !== null) {
        cancelAnimationFrame(frameRef.current);
        frameRef.current = null;
      }
    };
  }, []);

  const compact = mode !== "full";
  const circle = mode === "circle";

  return (
    <ToolbarModeContext.Provider value={mode}>
      {/* No extra child elements inside the row: the filter cluster must be
          the row's real first child, because index.css targets it with
          `.ae-toolbar > div:first-child`. (With the old gradient/spotlight
          divs in front, that selector matched the overlay in the real row
          but the filters in the hidden clones - so the row and its
          measurements disagreed, which is what left blank space.) The
          spotlight is therefore a ::before pseudo-element in CSS. */}
      <div
        className={`ae-toolbar ${compact ? "ae-toolbar--compact" : ""} ${circle ? "ae-toolbar--circle" : ""} ${className}`.trim()}
        style={{ WebkitOverflowScrolling: "touch" }}
        ref={rowRef}
      >
        {children}
      </div>

      {/* Three hidden clones of the same children, siblings of the real row
         (not children) - `.ae-toolbar--compact` / `--circle` are plain
         descendant selectors, so nesting a sizer inside the real row would
         let the row's own tier class corrupt the measurement.

         Nothing in the row animates its size, so a clone always reports its
         final width and the tier decision cannot flip on a transient one. */}
      <div
        aria-hidden
        style={{
          position: "absolute",
          width: 0,
          height: 0,
          overflow: "hidden",
        }}
      >
        <ToolbarModeContext.Provider value="full">
          <div
            ref={fullSizerRef}
            className="ae-toolbar ae-toolbar--sizer"
            style={{
              position: "absolute",
              visibility: "hidden",
              flexWrap: "nowrap",
              width: "max-content",
            }}
          >
            {children}
          </div>
        </ToolbarModeContext.Provider>
        <ToolbarModeContext.Provider value="compact">
          <div
            ref={compactSizerRef}
            className="ae-toolbar ae-toolbar--sizer ae-toolbar--compact"
            style={{
              position: "absolute",
              visibility: "hidden",
              flexWrap: "nowrap",
              width: "max-content",
            }}
          >
            {children}
          </div>
        </ToolbarModeContext.Provider>
        <ToolbarModeContext.Provider value="circle">
          <div
            ref={circleSizerRef}
            className="ae-toolbar ae-toolbar--sizer ae-toolbar--compact ae-toolbar--circle"
            style={{
              position: "absolute",
              visibility: "hidden",
              flexWrap: "nowrap",
              width: "max-content",
            }}
          >
            {children}
          </div>
        </ToolbarModeContext.Provider>
      </div>
    </ToolbarModeContext.Provider>
  );
}

/// Groups a page's action controls (CSV tools, PDF, zoom) so they sit
/// together with a shared gap, ready to be separated by a ToolbarDivider.
/// Never shrinks (see `.ae-toolbar-controls` in index.css); the filters
/// next to it are what give way.
export function ToolbarControls({ children }: { children: ReactNode }) {
  useContext(ToolbarModeContext);

  return (
    <div className="ae-toolbar-controls">{children}</div>
  );
}

/// A thin vertical hairline between two control groups. Rendered at every
/// tier; its color comes from `.ae-toolbar-divider` in index.css.
export function ToolbarDivider() {
  return <div className="ae-toolbar-divider" />;
}
