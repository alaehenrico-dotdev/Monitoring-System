/// Stacked bars: the plot is this many equal rows tall; each block in a stack is one row, so a day is a pile of identical
/// blocks and its height reads as a count (the tooltip has the exact figures).
export const STACK_ROWS = 24;
export const STACK_GAP_PX = 2;

/// The stacked blocks' size in whole DEVICE pixels, from the plot's real height. A block as a fraction of the plot
/// (100/24 % of 218px is 9.08px) puts each edge on a different sub-pixel, so some gaps draw as one pixel and others
/// as three. Whole device pixels make every block and every gap identical. Returns null until the height is known.
export function stackGrid(plotHeightCssPx: number, dpr: number): { rows: number; block: number; gap: number } | null {
  if (!(plotHeightCssPx > 0)) return null;
  const ratio = dpr > 0 ? dpr : 1;
  const heightDev = Math.floor(plotHeightCssPx * ratio);
  const gapDev = Math.max(1, Math.round(STACK_GAP_PX * ratio));
  const pitchDev = Math.max(gapDev + 2, Math.floor(heightDev / STACK_ROWS));
  return { rows: Math.max(1, Math.floor(heightDev / pitchDev)), block: (pitchDev - gapDev) / ratio, gap: gapDev / ratio };
}
