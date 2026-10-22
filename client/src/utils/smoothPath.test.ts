import { describe, expect, it } from "vitest";
import { smoothPath } from "./smoothPath";

describe("smoothPath", () => {
  it("handles zero, one and two points", () => {
    expect(smoothPath([])).toBe("");
    expect(smoothPath([{ x: 1, y: 2 }])).toBe("M1,2");
    expect(smoothPath([{ x: 0, y: 0 }, { x: 10, y: 5 }])).toBe("M0,0L10,5");
  });

  it("starts and ends on the first and last point", () => {
    const d = smoothPath([{ x: 0, y: 50 }, { x: 10, y: 20 }, { x: 20, y: 80 }]);
    expect(d.startsWith("M0,50C")).toBe(true);
    expect(d.endsWith("20,80")).toBe(true);
  });

  it("never overshoots a flat run: control points stay on the plateau", () => {
    const d = smoothPath([{ x: 0, y: 10 }, { x: 10, y: 50 }, { x: 20, y: 50 }, { x: 30, y: 10 }]);
    const ys = [...d.matchAll(/C([\d.]+),([\d.]+) ([\d.]+),([\d.]+)/g)].flatMap((m) => [Number(m[2]), Number(m[4])]);
    expect(Math.max(...ys)).toBeLessThanOrEqual(50);
    expect(Math.min(...ys)).toBeGreaterThanOrEqual(10);
  });
});
