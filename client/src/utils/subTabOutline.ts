/// The outline of a sub-page tab strip and its content - the Minimalism theme's boxed tab - as ONE path.
///
/// It used to be assembled from about ten CSS pieces (the tab's borders, two gradient feet, the frame's
/// sides, two corner pieces, the strip's rule). A browser snaps and anti-aliases each piece on its own, so
/// at fractional display scaling the joins between them never lined up exactly. One continuous stroke has
/// no joins: every curve flows into the next at any zoom.
///
/// Geometry, in CSS px from the frame's own top-left corner (the frame is the content box under the tab
/// strip). The line is drawn along its centre, with every corner a quarter circle:
///
///        ┌──────╮         ╭──────┐        the rule runs along the strip's bottom edge, turns up the
///   ╭────╯ tab  ╰────╮               the tab's sides in a curve (a "foot"), round its top corners,
///   │                │                and back down; the frame's sides and bottom close the box.
///   ╰────────────────╯
///
/// Pixel snapping: a 1px line drawn across two device pixels looks soft. Every edge is snapped to the device
/// pixel grid and the line is a whole number of device pixels thick (what a CSS border does), so the straight
/// parts are as crisp as the borders everywhere else on the page, and the curves are the only anti-aliased
/// parts.

export interface SubTabOutlineInput {
  /** The frame's border box. */
  width: number;
  height: number;
  /** Where the tab strip ends (its bottom edge), measured from the frame's top. The rule runs along it. */
  ruleBottom: number;
  /** The current tab's box, from the frame's top-left; null leaves the rule unbroken. */
  tab: { left: number; right: number; top: number } | null;
  /** Device pixels per CSS pixel (window.devicePixelRatio). */
  dpr?: number;
  /** Outer radius of every corner, in CSS px (the line's outside edge). */
  radius?: number;
}

export interface SubTabOutline {
  /** The SVG path, along the centre of the line. */
  d: string;
  /** The line's thickness in CSS px: a whole number of device pixels. */
  stroke: number;
  /** True when the current tab's opening is drawn; false when it did not fit (see below). */
  hasTab: boolean;
}

/// Every corner of the outline: a 4px outer radius, so the centre line is a 3.5px quarter circle on a 1px line.
export const OUTLINE_RADIUS = 4;

const n = (v: number) => String(Math.round(v * 1000) / 1000);

export function subTabOutline(input: SubTabOutlineInput): SubTabOutline {
  const dpr = input.dpr && input.dpr > 0 ? input.dpr : 1;
  const snap = (v: number) => Math.round(v * dpr) / dpr;
  // A whole number of device pixels, at least one: 1px at 100%, 1px at 125% and 150% (1 device px = 0.8 / 0.67 css
  // px is not what a border does: it is floor-ed to 1 device px), 2 device px at 200%.
  const devicePx = Math.max(1, Math.floor(dpr + 1e-6));
  const stroke = devicePx / dpr;
  const half = stroke / 2;
  const r = Math.max(0, (input.radius ?? OUTLINE_RADIUS) - half);

  // The frame's four sides and the rule, as centre lines.
  const x0 = half;
  const x1 = snap(input.width) - half;
  const yb = snap(input.height) - half;
  const yr = snap(input.ruleBottom) - half;

  let d = `M${n(x0)} ${n(yb - r)}V${n(yr + r)}A${n(r)} ${n(r)} 0 0 1 ${n(x0 + r)} ${n(yr)}`;

  // The tab's opening, when it fits. Its sides, top corners and the two feet need room on either side (the
  // frame's own corners must be clear of them) and above the rule. A tab scrolled partly out of the strip does
  // not fit: the rule is then drawn unbroken rather than with a distorted opening.
  let hasTab = false;
  if (input.tab) {
    const xl = snap(input.tab.left) + half;
    const xr = snap(input.tab.right) - half;
    const yt = snap(input.tab.top) + half;
    const fits = xl - r >= x0 + r && xr + r <= x1 - r && xr - xl >= 2 * r && yr - yt >= 2 * r;
    if (fits) {
      hasTab = true;
      d +=
        `H${n(xl - r)}A${n(r)} ${n(r)} 0 0 0 ${n(xl)} ${n(yr - r)}` + // the left foot, curving up into the tab's side
        `V${n(yt + r)}A${n(r)} ${n(r)} 0 0 1 ${n(xl + r)} ${n(yt)}` + // up the side and round the top-left corner
        `H${n(xr - r)}A${n(r)} ${n(r)} 0 0 1 ${n(xr)} ${n(yt + r)}` + // across the top and round the top-right corner
        `V${n(yr - r)}A${n(r)} ${n(r)} 0 0 0 ${n(xr + r)} ${n(yr)}`; // down the side and out along the rule: the right foot
    }
  }

  d +=
    `H${n(x1 - r)}A${n(r)} ${n(r)} 0 0 1 ${n(x1)} ${n(yr + r)}` + // along the rule and down the frame's right side
    `V${n(yb - r)}A${n(r)} ${n(r)} 0 0 1 ${n(x1 - r)} ${n(yb)}` + // the bottom-right corner
    `H${n(x0 + r)}A${n(r)} ${n(r)} 0 0 1 ${n(x0)} ${n(yb - r)}Z`; // along the bottom and up the left side

  return { d, stroke, hasTab };
}
