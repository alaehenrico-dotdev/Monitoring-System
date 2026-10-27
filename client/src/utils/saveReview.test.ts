import { describe, expect, it } from "vitest";
import { rowsEndingNegative, saveNotices } from "./saveReview";

const NOW = { date: "2026-10-27", shift: "MORNING" as const };
const texts = (n: ReturnType<typeof saveNotices>) => n.map((x) => x.text).join(" | ");

describe("saveNotices", () => {
  it("has nothing to say about an ordinary save on the open sheet", () => {
    expect(saveNotices({ date: "2026-10-27", shift: "MORNING", now: NOW })).toEqual([]);
  });

  it("warns that a past day is history and that later days are recalculated", () => {
    const [n] = saveNotices({ date: "2026-10-22", shift: "NIGHT", now: NOW });
    expect(n.tone).toBe("warn");
    expect(n.text).toMatch(/past day/);
    expect(n.text).toMatch(/recalculated/);
    expect(n.text).toMatch(/October 22, 2026/);
  });

  it("warns about a future date", () => {
    expect(saveNotices({ date: "2026-10-30", shift: "MORNING", now: NOW })[0]).toMatchObject({ tone: "warn" });
  });

  it("notes - without a warning - a shift that is not the open one today", () => {
    const [n] = saveNotices({ date: "2026-10-27", shift: "NIGHT", now: NOW });
    expect(n.tone).toBe("info");
    expect(n.text).toMatch(/not the shift that is open now/);
  });

  it("does not also call a past date's shift 'not open' - the date is the point", () => {
    const n = saveNotices({ date: "2026-10-22", shift: "NIGHT", now: NOW });
    expect(n).toHaveLength(1);
  });

  it("names the products that will end below zero, and what that blocks", () => {
    const n = saveNotices({ date: "2026-10-27", shift: "MORNING", now: NOW, negatives: [{ name: "PALM OIL", remaining: -11 }, { name: "RETAIL SALT", remaining: -3 }] });
    expect(n[0].tone).toBe("warn");
    expect(n[0].text).toMatch(/2 products will end below zero/);
    expect(n[0].text).toMatch(/PALM OIL \(-11\)/);
    expect(n[0].text).toMatch(/Finish Day/);
  });

  it("shortens a long list of negatives", () => {
    const many = Array.from({ length: 8 }, (_, i) => ({ name: `P${i}`, remaining: -1 }));
    expect(texts(saveNotices({ date: "2026-10-27", shift: "MORNING", now: NOW, negatives: many }))).toMatch(/and 3 more/);
  });

  it("says when a transfer is mirrored to the other table, and passes on the other-shift note", () => {
    const n = saveNotices({ date: "2026-10-27", shift: "MORNING", now: NOW, alsoUpdates: "Offline", otherShiftWarning: "Night already has 4 saved entries" });
    expect(texts(n)).toMatch(/also written to the Offline table/);
    expect(texts(n)).toMatch(/Night already has 4 saved entries/);
  });
});

describe("rowsEndingNegative", () => {
  const row = (id: number, name: string, remaining: unknown) => ({ product: { id, name }, entry: { remainingStock: remaining } });

  it("lists only rows this save touches, and only those below zero", () => {
    const rows = [row(1, "A", -2), row(2, "B", -9), row(3, "C", 5), row(4, "D", 0)];
    expect(rowsEndingNegative(rows, { 1: {}, 3: {}, 4: {} })).toEqual([{ name: "A", remaining: -2 }]);
  });

  it("copes with no rows and with non-numeric values", () => {
    expect(rowsEndingNegative(null, {})).toEqual([]);
    expect(rowsEndingNegative([row(1, "A", "n/a")], { 1: {} })).toEqual([]);
  });
});
