import { createContext, useContext, useEffect, useLayoutEffect, useRef, useState, type ReactNode, type MouseEvent as ReactMouseEvent } from "react";
import { motion, MotionConfig } from "motion/react";
import { toolbarLayoutTransition } from "../motion";
import { colors } from "../theme";

// Hysteresis buffers: how much *extra* spare room is required before
// stepping back up a tier (full <- compact <- stacked). Without this, a
// row sitting exactly at a breakpoint flickers between tiers on every
// sub-pixel resize/animation frame.
const COMPACT_EXIT_BUFFER = 32;
const STACK_EXIT_BUFFER = 24;

type ToolbarMode = "full" | "compact" | "stacked";

// Lets `ToolbarControls` know it's been dropped onto its own row (rather
// than reading a CSS class it can't see, since it's a sibling render, not
// a nested selector) so it can take the full row width and right-align
// instead of sitting squeezed into whatever space is left in the middle.
const ToolbarModeContext = createContext<ToolbarMode>("full");

const TOOLBAR_STYLE_TAG_ID = "ae-toolbar-style";
// Two different gradient behaviors on the same overlay element, switched
// by a class rather than by React state:
//   - at rest: a plain CSS `animation` sweeps `background-position` (runs
//     on the compositor, costs nothing on the main thread for as long as
//     any toolbar is mounted - same reasoning as the sidebar's gradient,
//     Sidebar.tsx).
//   - `--tracking`: the animation is paused (`animation-play-state`) and
//     `background-position` instead reads `--mx`/`--my`, two CSS custom
//     properties written straight from a `mousemove` handler via
//     `style.setProperty` (see `handlePointerMove` below) - never through
//     React state, which would re-render the whole toolbar tree on every
//     pointer event.
//
// `.ae-toolbar-spotlight`: a second, separate cursor-follow effect that
// lives *inside* the toolbar body (not on the border ring). It's a soft
// white radial glow centered on `--mx`/`--my` - the same two custom
// properties the border overlay already writes each `mousemove`, so both
// effects track the same pointer position for free with no extra reads.
// It's invisible (`opacity: 0`) until the pointer enters the row, then
// fades in/out via `--spotlight-opacity`, transitioned in CSS so the
// fade itself never touches React state either.
const TOOLBAR_STYLE = `
  @keyframes ae-toolbar-gradient-position {
    0%, 100% { background-position: 0% 50%; }
    50% { background-position: 100% 50%; }
  }
  .ae-toolbar-gradient-sweep {
    animation: ae-toolbar-gradient-position 13s linear infinite;
  }
  .ae-toolbar-gradient-sweep--tracking {
    animation-play-state: paused;
    background-position: var(--mx, 50%) var(--my, 50%);
  }
  .ae-toolbar-spotlight {
    opacity: var(--spotlight-opacity, 0);
    transition: opacity 220ms ease;
  }
`;

function useToolbarStyleTag() {
  useEffect(() => {
    if (document.getElementById(TOOLBAR_STYLE_TAG_ID)) return;
    const style = document.createElement("style");
    style.id = TOOLBAR_STYLE_TAG_ID;
    style.textContent = TOOLBAR_STYLE;
    document.head.appendChild(style);
  }, []);
}

/**
 * Card-style toolbar strip - the consistent home for a page's date/location
 * filters on one side and its action controls (CSV export/import, zoom) on
 * the other. Replaces a loose row of individually-bordered buttons floating
 * directly against the page background with one defined, bordered surface -
 * the same "toolbar" treatment used by every serious data-grid app.
 *
 * The border itself reuses the sidebar's gradient-sweep trick (Sidebar.tsx):
 * the real border is drawn transparent, and a separate absolutely-positioned
 * overlay - padded by exactly the border width, filled with a moving
 * yellow/gold/cream gradient, then mask-composited down to just that padding
 * ring - sits on top of it. At rest the gradient auto-sweeps; while the
 * cursor is over the toolbar, it recenters on the pointer instead (see
 * `handlePointerMove`/`handlePointerLeave`).
 *
 * A second, independent effect - `spotlightRef` - rides along on the same
 * pointer coordinates: a soft white glow inside the toolbar body itself
 * (not just the border ring) that fades in under the cursor on hover and
 * fades back out on leave, so the whole surface feels responsive to the
 * mouse, not just its edge.
 *
 * Responsiveness is a three-tier ladder, each step measured exactly rather
 * than guessed from a width breakpoint:
 *
 *   full     Filters and action buttons (with labels) side by side.
 *   compact  Same layout, but action buttons drop their labels down to
 *            icon-only (via `.ae-toolbar--compact` descendant CSS) once
 *            there's no longer room for the full-label row.
 *   stacked  Even icon-only controls don't fit next to the filters, so
 *            the action-control group wraps onto its own row instead of
 *            being crushed into whatever sliver of space is left in the
 *            middle - this is the state that used to not exist, which is
 *            what made narrow/awkward widths look broken.
 *
 * Two always-rendered, always-natural-width hidden clones (one per
 * candidate tier) are compared against the real row's available width on
 * every resize, so each tier only activates when there is *literally* not
 * enough room for the tier above it - never "just in case".
 */
export function Toolbar({ children, className = "" }: { children: ReactNode; className?: string }) {
  useToolbarStyleTag();

  const rowRef = useRef<HTMLDivElement>(null);
  const gradientRef = useRef<HTMLDivElement>(null);
  const spotlightRef = useRef<HTMLDivElement>(null);
  const fullSizerRef = useRef<HTMLDivElement>(null);
  const compactSizerRef = useRef<HTMLDivElement>(null);
  const modeRef = useRef<ToolbarMode>("full");
  const frameRef = useRef<number | null>(null);
  const [mode, setMode] = useState<ToolbarMode>("full");

  useLayoutEffect(() => {
    const row = rowRef.current;
    const fullSizer = fullSizerRef.current;
    const compactSizer = compactSizerRef.current;
    if (!row || !fullSizer || !compactSizer) return;

    // useLayoutEffect (not useEffect) so this measure-and-correct happens
    // before the browser paints - if the full layout would have wrapped
    // or overlapped, the user never sees that broken frame flash before
    // it corrects itself.
    function measure() {
      if (!row || !fullSizer || !compactSizer) return;

      const fullNeeded = fullSizer.getBoundingClientRect().width;
      const compactNeeded = compactSizer.getBoundingClientRect().width;
      const available = row.clientWidth;

      // Hysteresis per edge, evaluated relative to the CURRENT tier, so a
      // width sitting right at a boundary settles into one state instead
      // of oscillating every measurement.
      let next: ToolbarMode;
      switch (modeRef.current) {
        case "stacked":
          next =
            available >= compactNeeded + STACK_EXIT_BUFFER
              ? available >= fullNeeded
                ? "full"
                : "compact"
              : "stacked";
          break;
        case "compact":
          next =
            available < compactNeeded
              ? "stacked"
              : available >= fullNeeded + COMPACT_EXIT_BUFFER
                ? "full"
                : "compact";
          break;
        case "full":
        default:
          next = available >= fullNeeded ? "full" : available >= compactNeeded ? "compact" : "stacked";
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
    // expand/collapse, window resize) or either hidden sizer's own
    // natural width changes (e.g. an "Importing…" status message is
    // longer than "Import").
    const ro = new ResizeObserver(scheduleMeasure);
    ro.observe(row);
    ro.observe(fullSizer);
    ro.observe(compactSizer);
    return () => {
      ro.disconnect();
      if (frameRef.current !== null) {
        cancelAnimationFrame(frameRef.current);
        frameRef.current = null;
      }
    };
  }, []);

  // Writes `--mx`/`--my` straight onto the overlay elements rather than
  // through React state - state would mean a full toolbar re-render (and,
  // since this row's `layout` animation participates in Framer Motion's
  // shared measurement pass, a fresh round of layout reads) on every single
  // `mousemove`. A direct DOM write is the same trick the tier-detection
  // logic above already relies on RAF-batched reads for, just applied to a
  // write instead. Both the border gradient and the interior spotlight read
  // the same two properties off `row`, so they stay perfectly in sync with
  // no extra coordinate math.
  function handlePointerMove(e: ReactMouseEvent<HTMLDivElement>) {
    const gradientEl = gradientRef.current;
    const spotlightEl = spotlightRef.current;
    const row = rowRef.current;
    if (!row) return;
    const rect = row.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return;
    const x = ((e.clientX - rect.left) / rect.width) * 100;
    const y = ((e.clientY - rect.top) / rect.height) * 100;
    row.style.setProperty("--mx", `${x}%`);
    row.style.setProperty("--my", `${y}%`);
    row.style.setProperty("--spotlight-opacity", "1");
    gradientEl?.classList.add("ae-toolbar-gradient-sweep--tracking");
  }

  // Hands the gradient back to its auto-sweep once the cursor leaves - the
  // `--tracking` class removal un-pauses the CSS animation, which resumes
  // from wherever `background-position` currently sits (no jump/reset) -
  // and fades the interior spotlight back out via the same CSS transition
  // that faded it in.
  function handlePointerLeave() {
    gradientRef.current?.classList.remove("ae-toolbar-gradient-sweep--tracking");
    rowRef.current?.style.setProperty("--spotlight-opacity", "0");
  }

  const compact = mode !== "full";
  const stacked = mode === "stacked";

  return (
    <ToolbarModeContext.Provider value={mode}>
      <motion.div
        layout
        transition={toolbarLayoutTransition}
        className={`ae-toolbar ${compact ? "ae-toolbar--compact" : ""} ${stacked ? "ae-toolbar--stacked" : ""} ${className}`.trim()}
        onMouseMove={handlePointerMove}
        onMouseLeave={handlePointerLeave}
        // `position: relative` + a transparent `border` are both load-
        // bearing here, not cosmetic: `relative` gives the gradient-sweep
        // overlay below something to be `absolute`-positioned against, and
        // the transparent border reserves the same 0.5px of box space the
        // overlay's ring occupies - swapping to the overlay never causes a
        // layout shift the way toggling a real border on/off would.
        //
        // Deliberately NO `overflow: hidden` here - both overlay children
        // already clip themselves to this row's own rounded shape (the
        // gradient ring via its own mask, the spotlight via `background`'s
        // default border-box clip + `borderRadius: inherit`), so it isn't
        // needed for that. Adding it back reintroduces a real bug: on a page
        // where `ToolbarControls`' children change (mount to a wider set,
        // e.g. DailyReportPage's Export/PDF buttons appearing once a report
        // loads), this row's own auto-height collapses to a few px and clips
        // every control - reproduced with `layout` removed too, so it's not
        // a Framer Motion interaction, just `overflow: hidden` on this
        // specific flex row. `.ae-toolbar--compact`'s own `overflow: hidden`
        // (index.css) already covers the "never wrap to two lines in compact
        // mode" guarantee, so this one was redundant besides being buggy.
        style={{
          position: "relative",
          border: "0.5px solid transparent",
          ...(stacked ? { flexWrap: "wrap", rowGap: 8 } : undefined),
        }}
        ref={rowRef}
      >
        {/* Interior cursor-follow glow - separate from the border ring
            below. A soft white radial gradient centered on `--mx`/`--my`,
            sitting flush against the toolbar's own background (not masked
            to a ring), so the surface itself feels lit from wherever the
            pointer is. `mixBlendMode: "screen"` lets it brighten the card
            background/gradient-border underneath rather than sitting as a
            flat white patch on top of them. `pointer-events: none` and a
            low z-index-equivalent (rendered before `children`, same as the
            border overlay) keep it from ever intercepting clicks. Its
            opacity is driven purely by the `--spotlight-opacity` custom
            property set in `handlePointerMove`/`handlePointerLeave` above,
            transitioned via the `.ae-toolbar-spotlight` rule in
            `TOOLBAR_STYLE` - no React re-render involved. */}
        <div
          ref={spotlightRef}
          aria-hidden
          className="ae-toolbar-spotlight"
          style={{
            position: "absolute",
            inset: 0,
            borderRadius: "inherit",
            pointerEvents: "none",
            mixBlendMode: "screen",
            background:
              "radial-gradient(circle 220px at var(--mx, 50%) var(--my, 50%), rgba(255,255,255,0.35), rgba(255,255,255,0.08) 55%, transparent 75%)",
          }}
        />
        {/* Gradient-border trick, lifted from the sidebar (Sidebar.tsx):
            padded by exactly the border width, filled with a moving
            gradient, then masked so only that padding ring (not the
            center) is visible - the `xor`/`exclude` composite punches the
            content-box out of the full box, leaving a ring the same shape
            as the toolbar's own border-radius. Sits behind `children`
            (this is the first child, and `children` isn't given its own
            z-index/stacking context) so it never intercepts clicks on the
            real controls. */}
        <div
          ref={gradientRef}
          aria-hidden
          className="ae-toolbar-gradient-sweep"
          style={{
            position: "absolute",
            inset: 0,
            borderRadius: "inherit",
            padding: 0.5,
            pointerEvents: "none",
            // Black stops between each highlight color are what make the
            // sweep read clearly - without them the yellow/gold/cream trio
            // blends into one continuous warm glow with too little
            // contrast against the toolbar's own background.
            backgroundImage: `linear-gradient(115deg, ${colors.black}, ${colors.yellow}, ${colors.black}, ${colors.gold}, ${colors.black}, ${colors.cream}, ${colors.black}, ${colors.gold}, ${colors.black}, ${colors.yellow}, ${colors.black})`,
            backgroundSize: "400% 400%",
            WebkitMask: "linear-gradient(#fff 0 0) content-box, linear-gradient(#fff 0 0)",
            WebkitMaskComposite: "xor",
            maskComposite: "exclude",
          }}
        />
        {children}
      </motion.div>

      {/* Two hidden clones of the same children, a sibling of the real row
         (not a child) - critical, because `.ae-toolbar--compact`'s rules
         (hide the label, shrink the search box, ...) are plain descendant
         selectors. Nesting a sizer inside the real row would mean that once
         the row itself picks up a modifier class, the "always full" or
         "always compact" clone meant to represent that tier's natural width
         would get affected too, corrupting the very measurement it exists
         to provide (and creating a feedback loop). Both are clipped to 0x0
         so neither affects page layout or an ancestor's scrollable area -
         each sizer inside still lays out at its own natural (shrink-to-fit,
         single-line) size, it just never paints or takes space.
         
         MotionConfig duration:0 is load-bearing, not cosmetic: children can
         contain their own `motion.div layout` elements (e.g. ToolbarControls,
         or a page's own toolbar cluster) whose width changes for reasons
         that have nothing to do with responsive tier (a button's label text
         changing length, a badge mounting). Framer Motion animates a layout
         change via a CSS transform (FLIP), settling to the true size only
         once that transition ends - so getBoundingClientRect() on a clone
         still mid-transform reports a transient, not-yet-settled width. Fed
         into `measure()`, that transient reading caused the tier decision
         to react to an animation-in-progress and occasionally flip back and
         forth before the real width caught up - visible as the toolbar's
         right-hand controls (whichever side has width-changing content)
         glitching independently of the rest of the row. Forcing zero-
         duration transitions here means these clones always render at
         their final, settled size instantly, so every measurement is
         accurate - only the always-visible real row (outside this
         MotionConfig) actually animates. */}
      <div aria-hidden style={{ position: "absolute", width: 0, height: 0, overflow: "hidden" }}>
        <MotionConfig transition={{ duration: 0 }}>
          {/* Each clone is pinned to the tier it represents ("full" /
             "compact"), not the row's current live `mode` - otherwise, if
             the real row happened to be "stacked" right now, these clones
             would inherit that via context and render their own
             width:100%/stacked styling, corrupting the very "natural
             un-stacked width" measurement they exist to provide. */}
          <ToolbarModeContext.Provider value="full">
            <div
              ref={fullSizerRef}
              className="ae-toolbar"
              style={{ position: "absolute", visibility: "hidden", flexWrap: "nowrap", width: "max-content" }}
            >
              {children}
            </div>
          </ToolbarModeContext.Provider>
          <ToolbarModeContext.Provider value="compact">
            <div
              ref={compactSizerRef}
              className="ae-toolbar ae-toolbar--compact"
              style={{ position: "absolute", visibility: "hidden", flexWrap: "nowrap", width: "max-content" }}
            >
              {children}
            </div>
          </ToolbarModeContext.Provider>
        </MotionConfig>
      </div>
    </ToolbarModeContext.Provider>
  );
}

/// Groups a page's action controls (CSV tools, zoom) so they sit together
/// with a shared gap, ready to be separated from each other by a ToolbarDivider.
///
/// When the parent `Toolbar` has stepped down to its "stacked" tier (no
/// longer enough room to sit beside the filters, even icon-only), this
/// group takes the full row width and right-aligns itself on its own line
/// instead of being squeezed into a sliver of leftover center space - that
/// squeeze is what made the toolbar look broken at in-between widths.
export function ToolbarControls({ children }: { children: ReactNode }) {
  const mode = useContext(ToolbarModeContext);
  const stacked = mode === "stacked";

  return (
    <motion.div
      layout
      transition={toolbarLayoutTransition}
      className="ae-toolbar-controls"
      style={stacked ? { width: "100%", justifyContent: "flex-end" } : undefined}
    >
      {children}
    </motion.div>
  );
}

/// A thin vertical hairline between two control groups (e.g. CSV tools and
/// zoom) so they read as distinct clusters instead of one undifferentiated
/// row of buttons. Hidden when the toolbar is stacked, since a divider
/// meant to separate two groups sitting in the same row reads oddly once
/// the group above it is filters on one line and controls on the next.
export function ToolbarDivider() {
  const mode = useContext(ToolbarModeContext);
  if (mode === "stacked") return null;
  return <div className="ae-toolbar-divider" />;
}