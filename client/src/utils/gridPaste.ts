/**
 * Parsing and block-mapping for pasting a spreadsheet selection into the
 * Online/Offline grids (Excel / Google Sheets put tab-separated, newline-
 * delimited plain text on the clipboard).
 *
 * Deliberately free of React, the DOM and the clipboard API: everything here
 * is "given this text and this anchor, which cells get which values, and why
 * was each skipped cell skipped". That's the part worth testing exhaustively,
 * and it's the part that would otherwise be buried in an event handler.
 */

/**
 * Upper bound on cells written in one paste. A stray Ctrl+V of a whole
 * monthly workbook would otherwise stage thousands of edits in a single
 * undo step - recoverable, but alarming, and it makes Preview/Save
 * unreadable. The paste is refused outright rather than truncated: silently
 * applying the first 500 of someone's 3,000 cells is worse than applying
 * none, because the shortfall is invisible until it has been saved.
 */
export const MAX_PASTE_CELLS = 500;

export type SkipReason =
  | "not-editable"
  | "has-extra-columns"
  | "non-numeric"
  | "negative"
  | "out-of-range";

export const SKIP_REASON_TEXT: Record<SkipReason, string> = {
  "not-editable": "calculated column",
  "has-extra-columns": "column is split into extra columns",
  "non-numeric": "not a number",
  negative: "negative value",
  "out-of-range": "past the end of the grid",
};

export interface PasteEdit {
  productId: number;
  key: string;
  value: number;
}

export interface PasteSkip {
  reason: SkipReason;
  /// Human-readable cell reference, e.g. "Sweet A / Stocks In".
  where: string;
}

export interface PastePlan {
  edits: PasteEdit[];
  skipped: PasteSkip[];
  /// Set when the selection exceeds MAX_PASTE_CELLS - nothing is applied.
  tooLarge?: { cells: number };
}

/**
 * Splits clipboard text into a rectangular grid of raw cell strings.
 *
 * Handles CRLF (Windows Excel), LF and bare CR. A single trailing newline is
 * dropped - Excel appends one to every copied block, and taking it literally
 * would add a phantom row of blanks to every paste.
 */
export function parseClipboardGrid(text: string): string[][] {
  const normalized = text.replace(/\r\n?/g, "\n").replace(/\n$/, "");
  if (normalized === "") return [];
  return normalized.split("\n").map((line) => line.split("\t"));
}

export type ParsedCell =
  | { kind: "value"; value: number }
  /// Blank cell - "leave this one unchanged", not "set it to zero". Pasting
  /// a block with gaps must not wipe the figures already under the gaps.
  | { kind: "blank" }
  | { kind: "invalid"; reason: "non-numeric" | "negative" };

/**
 * One clipboard cell to a number.
 *
 * Accepts the shapes a spreadsheet actually emits: surrounding whitespace,
 * thousands separators ("1,250"), a leading + and decimals. Rejects anything
 * else for that cell alone - one bad cell in a block must not throw away the
 * other 99 good ones.
 */
export function parsePastedCell(raw: string): ParsedCell {
  const trimmed = raw.trim();
  if (trimmed === "") return { kind: "blank" };

  // Only strip commas that are actually thousands separators; "1,2,3" and
  // "1,25" (a European decimal comma) are ambiguous enough to refuse rather
  // than silently reinterpret as 123 and 125.
  let cleaned = trimmed;
  if (cleaned.includes(",")) {
    if (!/^[+-]?\d{1,3}(,\d{3})+(\.\d+)?$/.test(cleaned)) {
      return { kind: "invalid", reason: "non-numeric" };
    }
    cleaned = cleaned.replace(/,/g, "");
  }

  // Number("") is 0 and Number(" ") is 0 - both already handled above - but
  // Number("1e5") is 100000, which no encoder ever means to type.
  if (!/^[+-]?(\d+\.?\d*|\.\d+)$/.test(cleaned)) {
    return { kind: "invalid", reason: "non-numeric" };
  }
  const value = Number(cleaned);
  if (!Number.isFinite(value)) return { kind: "invalid", reason: "non-numeric" };
  // Same rule as isValidStockValue: a stock figure counts physical product.
  if (value < 0) return { kind: "invalid", reason: "negative" };
  return { kind: "value", value };
}

export interface PasteTargetRow {
  productId: number;
  /// For the skip reasons shown in the toast's tooltip.
  name: string;
}

export interface PasteTargetColumn {
  key: string;
  label: string;
  /// False for calculated/read-only columns, and for a main column whose
  /// amount is now the read-only sum of extra columns added under it.
  editable: boolean;
  /// Distinguishes "this column is calculated" from "this column was split
  /// into extra columns", which need different explanations.
  hasExtraColumns?: boolean;
}

/**
 * Maps a clipboard block onto the grid, anchored at the focused cell and
 * running right across `columns` and down across `rows`.
 *
 * `rows` is the grid's *visible row order* - whatever the page's search,
 * category and row filters left - so a paste lands on what the encoder can
 * see. Collapsed categories are deliberately NOT excluded: a collapsed
 * category is still part of the sheet, its rows are still in this list, and
 * a block spanning one must fill straight through it. (Staging into a
 * collapsed category is safe because StockGrid force-expands any category
 * holding a pending edit, so nothing ends up hidden.)
 *
 * `columns` is the full display-order column list including extra columns,
 * since those are ordinary editable cells that a block should flow across.
 */
export function planPaste(
  grid: string[][],
  anchor: { productId: number; key: string },
  rows: PasteTargetRow[],
  columns: PasteTargetColumn[],
  currentValueOf: (productId: number, key: string) => number | undefined,
): PastePlan {
  const cellCount = grid.reduce((n, line) => n + line.length, 0);
  if (cellCount > MAX_PASTE_CELLS) return { edits: [], skipped: [], tooLarge: { cells: cellCount } };

  const rowStart = rows.findIndex((r) => r.productId === anchor.productId);
  const colStart = columns.findIndex((c) => c.key === anchor.key);
  if (rowStart === -1 || colStart === -1) return { edits: [], skipped: [] };

  const edits: PasteEdit[] = [];
  const skipped: PasteSkip[] = [];
  // Counted once rather than per cell: a block hanging off the bottom of the
  // sheet is one fact ("12 cells past the end"), not 12 separate complaints.
  let outOfRange = 0;

  grid.forEach((line, dy) => {
    const row = rows[rowStart + dy];
    line.forEach((raw, dx) => {
      const col = columns[colStart + dx];
      if (!row || !col) {
        // A blank overhanging cell isn't a loss - nothing was going to be
        // written anyway, so it isn't worth reporting.
        if (parsePastedCell(raw).kind !== "blank") outOfRange += 1;
        return;
      }

      const parsed = parsePastedCell(raw);
      if (parsed.kind === "blank") return;

      const where = `${row.name} / ${col.label}`;
      if (!col.editable) {
        skipped.push({
          reason: col.hasExtraColumns ? "has-extra-columns" : "not-editable",
          where,
        });
        return;
      }
      if (parsed.kind === "invalid") {
        skipped.push({ reason: parsed.reason, where });
        return;
      }
      // A pasted value identical to what's already there is not an edit.
      // stageMany would drop it anyway (applyEdit removes a cell set back to
      // its saved value), but counting it as "pasted" would overstate what
      // the paste actually did.
      if (currentValueOf(row.productId, col.key) === parsed.value) return;
      edits.push({ productId: row.productId, key: col.key, value: parsed.value });
    });
  });

  if (outOfRange > 0) {
    skipped.push({ reason: "out-of-range", where: `${outOfRange} cell${outOfRange === 1 ? "" : "s"}` });
  }

  return { edits, skipped };
}

/// "Pasted 14 cells, skipped 2" for the toast body.
export function describePasteResult(plan: PastePlan): string {
  const skipped = plan.skipped.length;
  const n = plan.edits.length;
  const head = `Pasted ${n} cell${n === 1 ? "" : "s"}`;
  return skipped === 0 ? head : `${head}, skipped ${skipped}`;
}

/// Grouped reasons for the toast's title/tooltip - one line per reason with
/// an example, rather than 40 near-identical lines.
export function describePasteSkips(plan: PastePlan): string {
  if (plan.skipped.length === 0) return "";
  const byReason = new Map<SkipReason, string[]>();
  for (const s of plan.skipped) {
    const list = byReason.get(s.reason) ?? [];
    list.push(s.where);
    byReason.set(s.reason, list);
  }
  return [...byReason.entries()]
    .map(([reason, wheres]) => {
      const shown = wheres.slice(0, 3).join(", ");
      const more = wheres.length > 3 ? ` and ${wheres.length - 3} more` : "";
      return `${SKIP_REASON_TEXT[reason]}: ${shown}${more}`;
    })
    .join("\n");
}
