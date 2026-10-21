/// Which of the two lines a value belongs to. Online is gold, Offline blue
/// (--ae-viz-online / --ae-viz-offline); the bars are a muted neutral.
export type Series = "online" | "offline";
export const SERIES: Series[] = ["online", "offline"];

export interface ComboTooltip {
  title: string;
  /// Omit for a point with nothing recorded; `empty` is shown instead.
  rows?: { label: string; value: number; series?: Series }[];
  footer?: { text: string; alert?: boolean };
  empty?: string;
}

/// One x position: a bar and up to two line values. A null value means
/// "nothing recorded" - the bar is left out and the line breaks - never zero.
export interface ComboPoint {
  key: string | number;
  /// Text under the axis; the chart thins these out when there are many.
  label: string;
  /// Accessible name of the focusable column, also its keyboard readout.
  ariaLabel: string;
  bar: number | null;
  online: number | null;
  offline: number | null;
  /// A red dot under the label (e.g. a variance flag that day).
  flag?: boolean;
  /// The period still in progress: its label is emphasised.
  current?: boolean;
  tooltip: ComboTooltip;
}

/// Runs of consecutive points that have a value for `series`. A gap in the
/// data breaks the line instead of dragging it down to zero.
export function runs(points: ComboPoint[], series: Series) {
  const out: { i: number; v: number }[][] = [];
  let current: { i: number; v: number }[] = [];
  points.forEach((p, i) => {
    const v = p[series];
    if (v === null) {
      if (current.length) out.push(current);
      current = [];
    } else {
      current.push({ i, v });
    }
  });
  if (current.length) out.push(current);
  return out;
}

/// False while no line has two neighbouring points to join - every point is
/// then just a dot, which is worth telling the reader.
export function hasLines(points: ComboPoint[]): boolean {
  return SERIES.some((s) => runs(points, s).some((r) => r.length > 1));
}
