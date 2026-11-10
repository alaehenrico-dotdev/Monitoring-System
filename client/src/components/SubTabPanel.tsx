import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { subTabOutline } from "../utils/subTabOutline";

/// How long the outline takes to glide from the old tab to the new one.
const SLIDE_MS = 240;
/// And the content's fade-in when another tab is chosen.
const FADE_MS = 200;

interface TabBox {
  left: number;
  right: number;
  top: number;
}

const reducedMotion = () => typeof window !== "undefined" && !!window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
const easeOut = (k: number) => 1 - Math.pow(1 - k, 3);
const lerp = (a: number, b: number, k: number) => a + (b - a) * k;

/// The content a sub-page tab strip (`.ae-subtabs.ae-subtabs--framed`) switches between. It is the tab panel for
/// assistive technology, and it carries the Minimalism theme's boxed outline: ONE continuous line that runs along
/// the strip's rule, up and round the current tab, back along the rule, and down and round the whole content area,
/// so the tab and its content read as one box (see utils/subTabOutline.ts for why it is a single path).
/// In every other theme the outline is hidden and this is an unstyled wrapper.
///
/// The outline is measured, not guessed: it follows the real position of the strip, the current tab and the
/// frame, so it stays exact when the window or the browser zoom changes, when a font arrives and moves the tabs,
/// when the tab strip is scrolled sideways, and when another tab is chosen.
///
/// Choosing another tab is animated: the opening in the outline glides from the old tab to the new one (the whole
/// shape is recomputed every frame, so the curves stay true all the way), and the content fades up into place.
/// Nothing moves for someone who has asked their system for reduced motion.
export function SubTabPanel({ label, children }: { label?: string; children: ReactNode }) {
  const panelRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const pathRef = useRef<SVGPathElement>(null);
  const shownTab = useRef<TabBox | null>(null); // where the opening is drawn now, in the outline's own coordinates
  const frame = useRef(0);
  const clipId = useId();
  const [outline, setOutline] = useState<{ d: string; stroke: number; width: number; height: number; left: number; top: number } | null>(null);

  // The strip scrolls sideways on a phone: keep the chosen tab in view (it may have been tapped half off the edge).
  const lastSelected = useRef<Element | null>(null);
  useEffect(() => {
    const strip = panelRef.current?.previousElementSibling;
    const selected = strip?.querySelector('[aria-selected="true"]') ?? null;
    if (selected && selected !== lastSelected.current && strip instanceof HTMLElement && strip.scrollWidth > strip.clientWidth) {
      selected.scrollIntoView({ block: "nearest", inline: "nearest" });
    }
    lastSelected.current = selected;
  });

  const gliding = useRef(false);
  const measureAgain = useRef<(animate?: boolean) => void>(() => undefined);

  const measure = useCallback((animate = false) => {
    cancelAnimationFrame(frame.current);
    gliding.current = false;
    const panel = panelRef.current;
    const strip = panel?.previousElementSibling;
    if (!panel || !(strip instanceof HTMLElement) || !strip.classList.contains("ae-subtabs--framed")) {
      shownTab.current = null;
      setOutline(null);
      return;
    }
    const dpr = window.devicePixelRatio || 1;
    const snap = (v: number) => Math.round(v * dpr) / dpr;
    const p = panel.getBoundingClientRect();
    const s = strip.getBoundingClientRect();
    const t = strip.querySelector('[aria-selected="true"]')?.getBoundingClientRect() ?? null;
    // Everything is measured from a corner that sits exactly on a device pixel, so the straight parts of the line
    // fall on whole pixels. The SVG is then shifted by the (tiny) difference to start there.
    const ox = snap(p.left);
    const oy = snap(p.top);
    const base = { width: snap(p.right) - ox, height: snap(p.bottom) - oy, ruleBottom: snap(s.bottom) - oy, dpr };
    const target: TabBox | null = t ? { left: snap(t.left) - ox, right: snap(t.right) - ox, top: snap(t.top) - oy } : null;
    const place = (tab: TabBox | null) => {
      shownTab.current = tab;
      const result = subTabOutline({ ...base, tab, dpr });
      setOutline((prev) => {
        const next = { d: result.d, stroke: result.stroke, width: base.width, height: base.height, left: ox - p.left, top: oy - p.top };
        // Not a new object when nothing moved: this runs on every scroll and resize tick.
        return prev && prev.d === next.d && prev.stroke === next.stroke && prev.left === next.left && prev.top === next.top && prev.width === next.width && prev.height === next.height ? prev : next;
      });
    };

    // Where the opening is drawn NOW: the old tab, or - if another tab was chosen mid-glide - wherever the last glide
    // had got to, so a quick second click carries on from there instead of jumping.
    const from = shownTab.current;
    const glide = animate && from && target && !reducedMotion() && Math.abs(from.left - target.left) > 0.5;
    if (!glide || !from || !target) {
      place(target);
      return;
    }
    // Glide: every frame draws the whole outline with the opening part-way between the two tabs, writing the path
    // straight to the element (no React render per frame), then settles on a FRESH measurement and hands the final
    // shape to React to own. (Choosing a tab changes the label weights, which nudges the tabs' widths by a pixel; a
    // measurement taken at the start would be that pixel out.) The start is the first frame's own timestamp, so the
    // animation never mixes two clocks.
    gliding.current = true;
    let startedAt = -1;
    const step = (now: number) => {
      if (startedAt < 0) startedAt = now;
      const k = Math.min(1, (now - startedAt) / SLIDE_MS);
      const e = easeOut(k);
      const tab = { left: lerp(from.left, target.left, e), right: lerp(from.right, target.right, e), top: lerp(from.top, target.top, e) };
      shownTab.current = tab;
      pathRef.current?.setAttribute("d", subTabOutline({ ...base, tab, dpr }).d);
      if (k < 1) frame.current = requestAnimationFrame(step);
      else measureAgain.current(false);
    };
    frame.current = requestAnimationFrame(step);
  }, []);
  // The glide's last frame calls measure again; the ref hands it the current one without a self-reference.
  useLayoutEffect(() => {
    measureAgain.current = measure;
  }, [measure]);

  // Before the first paint (no frame without an outline), and again whenever another tab is chosen: that one glides.
  const firstRun = useRef(true);
  useLayoutEffect(() => {
    measure(!firstRun.current);
  }, [measure, label]);

  // The content settles in when another tab is chosen (not on the first showing).
  useEffect(() => {
    if (firstRun.current) {
      firstRun.current = false;
      return;
    }
    if (reducedMotion()) return;
    contentRef.current?.animate?.([{ opacity: 0, transform: "translateY(6px)" }, { opacity: 1, transform: "none" }], { duration: FADE_MS, easing: "cubic-bezier(0.22, 1, 0.36, 1)" });
  }, [label]);

  useEffect(() => {
    const panel = panelRef.current;
    const strip = panel?.previousElementSibling;
    if (!panel || !(strip instanceof HTMLElement)) return;
    // Anything but a tab change moves the outline at once - except while it is gliding, which settles on a fresh
    // measurement when it ends (a resize notification caused by the tab change itself would otherwise cut it short).
    const jump = () => {
      if (!gliding.current) measure(false);
    };
    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(jump);
    observer?.observe(panel);
    observer?.observe(strip);
    const current = strip.querySelector('[aria-selected="true"]');
    if (current) observer?.observe(current);
    strip.addEventListener("scroll", jump, { passive: true });
    window.addEventListener("resize", jump);
    // A web font arriving changes the tab widths without any resize event reaching us in time.
    void document.fonts?.ready.then(jump);
    return () => {
      observer?.disconnect();
      strip.removeEventListener("scroll", jump);
      window.removeEventListener("resize", jump);
      // NOT cancelAnimationFrame here: this cleanup also runs when another tab is chosen, straight after the layout
      // effect above started the glide, and would cut it off before its first frame. Unmounting cancels it below.
    };
  }, [measure, label]);

  useEffect(() => () => cancelAnimationFrame(frame.current), []);

  return (
    <div ref={panelRef} className="ae-subtab-panel" role="tabpanel" aria-label={label}>
      <div ref={contentRef} className="ae-subtab-panel-content">
        {children}
      </div>
      {outline && (
        <svg
          className="ae-subtab-outline"
          aria-hidden="true"
          focusable="false"
          width={outline.width}
          height={outline.height}
          style={{ left: outline.left, top: outline.top }}
        >
          {/* The strip and the frame share their left and right edges, so clipping to the frame's width only ever
              trims a tab that has been scrolled out past the strip's ends. */}
          <clipPath id={clipId}>
            <rect x={0} y={-4000} width={outline.width} height={outline.height + 4008} />
          </clipPath>
          <path ref={pathRef} d={outline.d} clipPath={`url(#${clipId})`} fill="none" strokeWidth={outline.stroke} strokeLinecap="butt" strokeLinejoin="round" />
        </svg>
      )}
    </div>
  );
}
