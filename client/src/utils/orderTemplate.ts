import type { XlsxStyledCell } from "./xlsx";
import { categoryKey, strictNameKey } from "./importMatch";

/**
 * "Encoder product and category default order" Excel template.
 *
 * Read from column A, by how the text is formatted rather than where it sits:
 *   - only BOLD text counts (title cells, notes and "VARIANCE: 36" footers are not);
 *   - a bold cell in a bigger font than the rest is a CATEGORY heading;
 *   - every other bold cell is a PRODUCT of the category above it.
 * The sheet's own title rows (a date, "SKU'S") are bold and big too, but a
 * heading with no product under it adds nothing, so they never become categories.
 */
export interface TemplateRow {
  category: string;
  name: string;
}

/// The most common font size among the given cells - the size products are
/// written in, which is what makes a bigger one a heading.
function modeSize(cells: XlsxStyledCell[]): number {
  const counts = new Map<number, number>();
  for (const c of cells) counts.set(c.size, (counts.get(c.size) ?? 0) + 1);
  let best = 11;
  let bestCount = 0;
  for (const [size, n] of counts) {
    if (n > bestCount || (n === bestCount && size < best)) {
      best = size;
      bestCount = n;
    }
  }
  return best;
}

export function templateRowsFromColumn(cells: XlsxStyledCell[]): TemplateRow[] {
  // A bare number is a date or a figure, never a name.
  const bold = cells.filter((c) => c.bold && !/^[\d.,\s-]+$/.test(c.text));
  const productSize = modeSize(bold);

  const rows: TemplateRow[] = [];
  const seen = new Set<string>();
  let heading: string | null = null;
  for (const c of bold) {
    if (c.size > productSize) {
      heading = c.text;
      continue;
    }
    // Before any heading there is no category to put it under.
    const category = heading ?? "";
    const key = `${categoryKey(category)}|${strictNameKey(c.text)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    rows.push({ category, name: c.text });
  }
  return rows;
}
