export interface XY {
  x: number;
  y: number;
}

/// An SVG path through `pts` (ascending x) as a smooth curve that never
/// overshoots: monotone cubic interpolation (Fritsch-Carlson), so a line that
/// is flat or rising between two readings is never drawn dipping below them -
/// which on a stock chart would read as stock going negative between two days.
/// One point gives just a move; two give a straight line.
export function smoothPath(pts: XY[]): string {
  const n = pts.length;
  if (n === 0) return "";
  const f = (v: number) => +v.toFixed(3);
  if (n === 1) return `M${f(pts[0].x)},${f(pts[0].y)}`;
  if (n === 2) return `M${f(pts[0].x)},${f(pts[0].y)}L${f(pts[1].x)},${f(pts[1].y)}`;

  const dx: number[] = [];
  const slope: number[] = [];
  for (let i = 0; i < n - 1; i++) {
    dx.push(pts[i + 1].x - pts[i].x);
    slope.push((pts[i + 1].y - pts[i].y) / dx[i]);
  }
  const tangent: number[] = [slope[0]];
  for (let i = 1; i < n - 1; i++) {
    tangent.push(slope[i - 1] * slope[i] <= 0 ? 0 : (slope[i - 1] + slope[i]) / 2);
  }
  tangent.push(slope[n - 2]);
  for (let i = 0; i < n - 1; i++) {
    if (slope[i] === 0) {
      tangent[i] = 0;
      tangent[i + 1] = 0;
      continue;
    }
    const a = tangent[i] / slope[i];
    const b = tangent[i + 1] / slope[i];
    const h = Math.hypot(a, b);
    if (h > 3) {
      const t = 3 / h;
      tangent[i] = t * a * slope[i];
      tangent[i + 1] = t * b * slope[i];
    }
  }

  let d = `M${f(pts[0].x)},${f(pts[0].y)}`;
  for (let i = 0; i < n - 1; i++) {
    const h = dx[i] / 3;
    d += `C${f(pts[i].x + h)},${f(pts[i].y + tangent[i] * h)} ${f(pts[i + 1].x - h)},${f(pts[i + 1].y - tangent[i + 1] * h)} ${f(pts[i + 1].x)},${f(pts[i + 1].y)}`;
  }
  return d;
}
