/**
 * A day that was entered by shift (a Morning and a Night sheet), seen as one
 * whole-day row - what the entry pages show for such a day once shifts are
 * switched off. The flows of the two sheets add up; the opening is the day's
 * first (the Morning one), and the caller recomputes the subtotal and Remaining
 * from the summed figures with the usual stock formulas, so they always agree
 * with the combined row rather than with either sheet alone.
 *
 * Pure: no database, no framework.
 */
export function combineSplitRows<T extends object>(
  morning: T | undefined,
  night: T | undefined,
  sumKeys: readonly string[],
): (T & { openingStock: number }) | null {
  const base = night ?? morning;
  if (!base) return null;
  const read = (row: T | undefined, key: string) => (row ? Number((row as Record<string, unknown>)[key] ?? 0) : 0);
  const sums: Record<string, number> = {};
  for (const key of sumKeys) sums[key] = Math.round((read(morning, key) + read(night, key)) * 100) / 100;
  const opening = Number(((morning ?? night) as Record<string, unknown>).openingStock ?? 0);
  return { ...base, ...sums, openingStock: opening };
}

/// Marks a row as the combined view of a split day, so the page can show it read-only.
export const WHOLE_DAY_COMBINED = "wholeDayCombined";
