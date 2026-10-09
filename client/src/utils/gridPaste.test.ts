import { describe, expect, it } from "vitest";
import {
  describePasteResult,
  describePasteSkips,
  MAX_PASTE_CELLS,
  parseClipboardGrid,
  parsePastedCell,
  planPaste,
  type PasteTargetColumn,
  type PasteTargetRow,
} from "./gridPaste";

describe("parseClipboardGrid", () => {
  it("splits tabs into columns and newlines into rows", () => {
    expect(parseClipboardGrid("1\t2\n3\t4")).toEqual([
      ["1", "2"],
      ["3", "4"],
    ]);
  });

  it("handles Windows CRLF and bare CR line endings", () => {
    expect(parseClipboardGrid("1\t2\r\n3\t4")).toEqual([["1", "2"], ["3", "4"]]);
    expect(parseClipboardGrid("1\r2")).toEqual([["1"], ["2"]]);
  });

  it("drops the single trailing newline Excel appends", () => {
    expect(parseClipboardGrid("1\t2\n")).toEqual([["1", "2"]]);
  });

  it("keeps interior blank cells, which mean 'leave unchanged'", () => {
    expect(parseClipboardGrid("1\t\t3")).toEqual([["1", "", "3"]]);
  });

  it("returns nothing for empty text", () => {
    expect(parseClipboardGrid("")).toEqual([]);
    expect(parseClipboardGrid("\n")).toEqual([]);
  });

  it("treats a single value as a 1x1 grid", () => {
    expect(parseClipboardGrid("42")).toEqual([["42"]]);
  });
});

describe("parsePastedCell", () => {
  it("parses plain integers and decimals", () => {
    expect(parsePastedCell("42")).toEqual({ kind: "value", value: 42 });
    expect(parsePastedCell("3.5")).toEqual({ kind: "value", value: 3.5 });
    expect(parsePastedCell(".5")).toEqual({ kind: "value", value: 0.5 });
  });

  it("trims surrounding whitespace", () => {
    expect(parsePastedCell("  7  ")).toEqual({ kind: "value", value: 7 });
  });

  it("accepts commas as thousands separators", () => {
    expect(parsePastedCell("1,250")).toEqual({ kind: "value", value: 1250 });
    expect(parsePastedCell("1,250,000.25")).toEqual({ kind: "value", value: 1250000.25 });
  });

  it("rejects ambiguous comma placement rather than guessing", () => {
    expect(parsePastedCell("1,25")).toEqual({ kind: "invalid", reason: "non-numeric" });
    expect(parsePastedCell("1,2,3")).toEqual({ kind: "invalid", reason: "non-numeric" });
  });

  it("treats blank as 'leave unchanged', not zero", () => {
    expect(parsePastedCell("")).toEqual({ kind: "blank" });
    expect(parsePastedCell("   ")).toEqual({ kind: "blank" });
  });

  it("rejects negatives", () => {
    expect(parsePastedCell("-5")).toEqual({ kind: "invalid", reason: "negative" });
  });

  it("rejects non-numeric text", () => {
    expect(parsePastedCell("abc")).toEqual({ kind: "invalid", reason: "non-numeric" });
    expect(parsePastedCell("12kg")).toEqual({ kind: "invalid", reason: "non-numeric" });
    expect(parsePastedCell("#REF!")).toEqual({ kind: "invalid", reason: "non-numeric" });
  });

  it("rejects scientific notation, which is never a typed stock figure", () => {
    expect(parsePastedCell("1e5")).toEqual({ kind: "invalid", reason: "non-numeric" });
  });

  it("accepts zero", () => {
    expect(parsePastedCell("0")).toEqual({ kind: "value", value: 0 });
  });
});

const ROWS: PasteTargetRow[] = [
  { productId: 1, name: "Sweet A" },
  { productId: 2, name: "Green Mango" },
  { productId: 3, name: "Spiced Vinegar" },
];

const COLUMNS: PasteTargetColumn[] = [
  { key: "openingStock", label: "Stocks (Opening)", editable: false },
  { key: "stockIn", label: "Stocks In", editable: true },
  { key: "stockOut", label: "Stocks Out", editable: true },
  { key: "onlineStock", label: "Online Stocks", editable: false },
  { key: "productionIn", label: "Production (In)", editable: true },
];

/// Everything currently 0, so any non-zero paste counts as a change.
type CurrentValue = (productId: number, key: string) => number | undefined;
const allZero: CurrentValue = () => 0;

function plan(
  text: string,
  key = "stockIn",
  productId = 1,
  columns = COLUMNS,
  current: CurrentValue = allZero,
) {
  return planPaste(parseClipboardGrid(text), { productId, key }, ROWS, columns, current);
}

describe("planPaste - block mapping", () => {
  it("fills right across columns and down across rows from the anchor", () => {
    const p = plan("1\t2\n3\t4");
    expect(p.edits).toEqual([
      { productId: 1, key: "stockIn", value: 1 },
      { productId: 1, key: "stockOut", value: 2 },
      { productId: 2, key: "stockIn", value: 3 },
      { productId: 2, key: "stockOut", value: 4 },
    ]);
  });

  it("keeps today's behavior for a single value in a single cell", () => {
    const p = plan("42");
    expect(p.edits).toEqual([{ productId: 1, key: "stockIn", value: 42 }]);
    expect(p.skipped).toEqual([]);
  });

  it("leaves blank cells unchanged instead of zeroing them", () => {
    const p = plan("1\t\n\t4");
    expect(p.edits).toEqual([
      { productId: 1, key: "stockIn", value: 1 },
      { productId: 2, key: "stockOut", value: 4 },
    ]);
  });

  it("skips calculated columns the block flows across, but keeps going", () => {
    // Anchored on stockOut, so the block covers stockOut, onlineStock
    // (calculated) and productionIn.
    const p = plan("1\t2\t3", "stockOut");
    expect(p.edits).toEqual([
      { productId: 1, key: "stockOut", value: 1 },
      { productId: 1, key: "productionIn", value: 3 },
    ]);
    expect(p.skipped).toEqual([
      { reason: "not-editable", where: "Sweet A / Online Stocks" },
    ]);
  });

  it("rejects a cell whose main column was split into extra columns", () => {
    const split: PasteTargetColumn[] = [
      { key: "stockIn", label: "Stocks In", editable: false, hasExtraColumns: true },
      { key: "stockIn__x1", label: "Stocks In +1", editable: true },
    ];
    const p = planPaste(parseClipboardGrid("5\t6"), { productId: 1, key: "stockIn" }, ROWS, split, allZero);
    expect(p.edits).toEqual([{ productId: 1, key: "stockIn__x1", value: 6 }]);
    expect(p.skipped).toEqual([
      { reason: "has-extra-columns", where: "Sweet A / Stocks In" },
    ]);
  });

  it("rejects only the offending cell on a negative or non-numeric value", () => {
    const p = plan("1\t-2\n3\tabc");
    expect(p.edits).toEqual([
      { productId: 1, key: "stockIn", value: 1 },
      { productId: 2, key: "stockIn", value: 3 },
    ]);
    expect(p.skipped).toEqual([
      { reason: "negative", where: "Sweet A / Stocks Out" },
      { reason: "non-numeric", where: "Green Mango / Stocks Out" },
    ]);
  });

  it("reports cells hanging off the bottom of the grid as one skip", () => {
    const p = plan("1\n2\n3\n4\n5", "stockIn", 3);
    expect(p.edits).toEqual([{ productId: 3, key: "stockIn", value: 1 }]);
    expect(p.skipped).toEqual([{ reason: "out-of-range", where: "4 cells" }]);
  });

  it("does not complain about blank cells hanging off the edge", () => {
    const p = plan("1\n\n", "stockIn", 3);
    expect(p.skipped).toEqual([]);
  });

  it("stages into rows of collapsed categories - collapse is display-only", () => {
    // planPaste is given the visible row order; collapse never removes rows
    // from it, so a block simply flows through.
    const p = plan("1\n2\n3");
    expect(p.edits).toHaveLength(3);
    expect(p.edits.map((e) => e.productId)).toEqual([1, 2, 3]);
  });

  it("drops a pasted value identical to what is already in the cell", () => {
    const p = plan("5\t6", "stockIn", 1, COLUMNS, (_id, key) => (key === "stockIn" ? 5 : 0));
    expect(p.edits).toEqual([{ productId: 1, key: "stockOut", value: 6 }]);
  });

  it("returns nothing when the anchor is not in the grid", () => {
    expect(plan("1", "nope").edits).toEqual([]);
    expect(plan("1", "stockIn", 999).edits).toEqual([]);
  });
});

describe("planPaste - size cap", () => {
  it(`refuses a paste over ${MAX_PASTE_CELLS} cells without applying any of it`, () => {
    const line = Array.from({ length: 10 }, () => "1").join("\t");
    const text = Array.from({ length: 51 }, () => line).join("\n"); // 510 cells
    const p = planPaste(parseClipboardGrid(text), { productId: 1, key: "stockIn" }, ROWS, COLUMNS, allZero);
    expect(p.tooLarge).toEqual({ cells: 510 });
    expect(p.edits).toEqual([]);
  });

  it("allows a paste exactly at the cap", () => {
    const line = Array.from({ length: 10 }, () => "1").join("\t");
    const text = Array.from({ length: 50 }, () => line).join("\n"); // 500 cells
    const p = planPaste(parseClipboardGrid(text), { productId: 1, key: "stockIn" }, ROWS, COLUMNS, allZero);
    expect(p.tooLarge).toBeUndefined();
  });
});

describe("paste result messages", () => {
  it("summarises a clean paste", () => {
    expect(describePasteResult({ edits: [{ productId: 1, key: "a", value: 1 }], skipped: [] })).toBe("Pasted 1 cell");
  });

  it("summarises a paste with skips", () => {
    const p = plan("1\t-2\n3\tabc");
    expect(describePasteResult(p)).toBe("Pasted 2 cells, skipped 2");
  });

  it("groups skip reasons for the tooltip", () => {
    const p = plan("1\t-2\n3\tabc");
    expect(describePasteSkips(p)).toBe(
      "negative value: Sweet A / Stocks Out\nnot a number: Green Mango / Stocks Out",
    );
  });

  it("truncates a long list of same-reason skips", () => {
    const skipped = Array.from({ length: 5 }, (_, i) => ({ reason: "negative" as const, where: `P${i}` }));
    expect(describePasteSkips({ edits: [], skipped })).toBe(
      "negative value: P0, P1, P2 and 2 more",
    );
  });

  it("says nothing when there is nothing to explain", () => {
    expect(describePasteSkips({ edits: [], skipped: [] })).toBe("");
  });
});
