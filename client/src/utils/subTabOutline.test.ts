import { describe, expect, it } from "vitest";
import { OUTLINE_RADIUS, subTabOutline } from "./subTabOutline";

// The frame: 600 x 300, the strip ends exactly at its top (ruleBottom 0), the current tab is 110 wide and 33 tall.
const frame = { width: 600, height: 300, ruleBottom: 0, tab: { left: 10, right: 120, top: -33 } };
const arcs = (d: string) => (d.match(/A/g) ?? []).length;
// Every number in a path, in order.
const numbers = (d: string) => (d.match(/-?\d+(?:\.\d+)?/g) ?? []).map(Number);

describe("subTabOutline", () => {
  it("draws the whole outline as one closed path: the rule, up and round the tab, and the frame's four corners", () => {
    const { d, stroke, hasTab } = subTabOutline({ ...frame, dpr: 1 });
    expect(hasTab).toBe(true);
    expect(stroke).toBe(1);
    // The line's centre: half a pixel in from every edge, and every corner a 3.5px quarter circle (4px outside).
    expect(d).toBe(
      "M0.5 296V3A3.5 3.5 0 0 1 4 -0.5" + // up the left side, round the frame's top-left corner
        "H7A3.5 3.5 0 0 0 10.5 -4" + //          along the rule, the left foot curving up into the tab
        "V-29A3.5 3.5 0 0 1 14 -32.5" + //        up the tab's side, round its top-left corner
        "H116A3.5 3.5 0 0 1 119.5 -29" + //       across the top, round its top-right corner
        "V-4A3.5 3.5 0 0 0 123 -0.5" + //         down the side, the right foot out along the rule
        "H596A3.5 3.5 0 0 1 599.5 3" + //         the rule to the frame's top-right corner
        "V296A3.5 3.5 0 0 1 596 299.5" + //       down the right side, round the bottom-right corner
        "H4A3.5 3.5 0 0 1 0.5 296Z", //           along the bottom, round the bottom-left corner, and close
    );
    expect(arcs(d)).toBe(8); // four frame corners, two feet, two tab corners
    expect(OUTLINE_RADIUS).toBe(4);
  });

  it("leaves the rule unbroken when there is no current tab, or it is too close to the frame's corner to fit", () => {
    for (const tab of [null, { left: 2, right: 112, top: -33 }, { left: 10, right: 596, top: -33 }, { left: -40, right: 60, top: -33 }]) {
      const out = subTabOutline({ ...frame, tab, dpr: 1 });
      expect(out.hasTab).toBe(false);
      expect(arcs(out.d)).toBe(4);
      expect(out.d.endsWith("Z")).toBe(true);
    }
  });

  it("puts every straight edge on a whole device pixel at any display scaling, with a line a whole number of device pixels thick", () => {
    for (const dpr of [0.5, 0.67, 1, 1.1, 1.25, 1.5, 1.75, 2, 2.5, 3]) {
      const { d, stroke } = subTabOutline({ ...frame, dpr });
      // A whole number of device pixels, at least one.
      expect(Math.abs(stroke * dpr - Math.round(stroke * dpr))).toBeLessThan(1e-9);
      expect(stroke * dpr).toBeGreaterThanOrEqual(1 - 1e-9);
      // Walk the path. Along a horizontal run the y is fixed and along a vertical run the x is: that is the line's
      // position, and its outer edge (the centre line - and + half the thickness) must sit on the pixel grid, or the
      // line would be spread over two pixels and look soft.
      const half = stroke / 2;
      let x = 0;
      let y = 0;
      let straight = 0;
      for (const m of d.matchAll(/([MHVA])([^MHVAZ]+)/g)) {
        const v = m[2].trim().split(/[ ,]+/).map(Number);
        if (m[1] === "M") [x, y] = v;
        if (m[1] === "A") [x, y] = [v[5], v[6]];
        if (m[1] === "H") {
          straight++;
          const edge = (y - half) * dpr; // the run's top edge
          expect(Math.abs(edge - Math.round(edge))).toBeLessThan(0.005);
          x = v[0];
        }
        if (m[1] === "V") {
          straight++;
          const edge = (x - half) * dpr; // the run's left edge
          expect(Math.abs(edge - Math.round(edge))).toBeLessThan(0.005);
          y = v[0];
        }
      }
      expect(straight).toBe(8); // four on the frame, two on the tab, and the rule's two halves
    }
  });

  it("keeps every coordinate inside the frame (and the tab above it), so nothing is drawn outside the box", () => {
    const { d } = subTabOutline({ ...frame, dpr: 1 });
    const xs = [] as number[];
    const ys = [] as number[];
    // Pairs after each command: M x y, A rx ry rot f s x y; H x; V y.
    for (const m of d.matchAll(/([MHVA])([^MHVAZ]+)/g)) {
      const v = m[2].trim().split(/[ ,]+/).map(Number);
      if (m[1] === "M") {
        xs.push(v[0]);
        ys.push(v[1]);
      }
      if (m[1] === "H") xs.push(v[0]);
      if (m[1] === "V") ys.push(v[0]);
      if (m[1] === "A") {
        xs.push(v[5]);
        ys.push(v[6]);
      }
    }
    expect(Math.min(...xs)).toBeGreaterThanOrEqual(0);
    expect(Math.max(...xs)).toBeLessThanOrEqual(600);
    expect(Math.min(...ys)).toBeGreaterThanOrEqual(-33); // the tab's top edge
    expect(Math.max(...ys)).toBeLessThanOrEqual(300);
    expect(numbers(d).every(Number.isFinite)).toBe(true);
  });

  it("moves the opening with the tab: the same frame, another tab", () => {
    const a = subTabOutline({ ...frame, dpr: 1 }).d;
    const b = subTabOutline({ ...frame, tab: { left: 130, right: 230, top: -33 }, dpr: 1 }).d;
    expect(a).not.toBe(b);
    expect(b).toContain("H127A3.5 3.5 0 0 0 130.5 -4"); // the left foot of the tab at 130
    expect(b).toContain("H226A3.5 3.5 0 0 1 229.5 -29"); // its top-right corner
    // Everything that is not the opening is identical: the frame is the same box.
    expect(b.startsWith("M0.5 296V3A3.5 3.5 0 0 1 4 -0.5")).toBe(true);
    expect(b.endsWith("H596A3.5 3.5 0 0 1 599.5 3V296A3.5 3.5 0 0 1 596 299.5H4A3.5 3.5 0 0 1 0.5 296Z")).toBe(true);
  });
});
