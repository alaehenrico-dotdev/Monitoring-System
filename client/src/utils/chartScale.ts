export interface ChartScale {
  /// Top of the axis - the smallest tick at or above the data's maximum.
  max: number;
  /// Evenly spaced tick values from 0 up to `max`, both included.
  ticks: number[];
}

/// A y-axis that ends on round numbers (0 / 20K / 40K ...) instead of the raw
/// data maximum, so gridlines land on values a reader can say out loud. Steps
/// are 1, 2, 2.5 or 5 times a power of ten, aiming for about `intervals` gaps.
///
/// The axis never tops out below `intervals`, so its steps are never below 1:
/// a period with no movement (or a handful of units) would otherwise get ticks
/// like 0.25 and 0.75, which the compact axis labels round to a misleading
/// "0.3" and "0.8".
export function niceScale(dataMax: number, intervals = 4): ChartScale {
  const top = Math.max(Number.isFinite(dataMax) ? dataMax : 0, intervals);
  const rough = top / intervals;
  const magnitude = 10 ** Math.floor(Math.log10(rough));
  const fraction = rough / magnitude;
  const step = (fraction <= 1 ? 1 : fraction <= 2 ? 2 : fraction <= 2.5 ? 2.5 : fraction <= 5 ? 5 : 10) * magnitude;
  const count = Math.ceil(top / step - 1e-9);
  // Multiplying the index (not summing the step) keeps fractional steps from
  // accumulating floating-point drift.
  const ticks = Array.from({ length: count + 1 }, (_, i) => +(i * step).toPrecision(12));
  return { max: ticks[ticks.length - 1], ticks };
}
