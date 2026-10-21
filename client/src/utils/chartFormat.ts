/// 12,300 -> "12.3K": axis ticks, where room is tight.
export const compactNumber = new Intl.NumberFormat(undefined, {
  notation: "compact",
  maximumFractionDigits: 1,
});

/// 12,300 -> "12,300": tooltips, tables and accessible names, where the exact
/// figure matters.
export const fullNumber = new Intl.NumberFormat();
