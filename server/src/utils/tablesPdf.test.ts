import { describe, expect, it } from "vitest";
import { pdfText, renderTablesPdf, type PdfTable } from "./tablesPdf";

const table = (over: Partial<PdfTable> = {}): PdfTable => ({
  name: "Online",
  columns: ["Category", "SKU", "Product", "Opening", "Remaining"],
  rows: [
    ["Class A", "A1", "Alpha", 10, 13.5],
    ["Class A", "A2", "Beta", 0, 1234567.891],
    ["Class B", "", "Gamma", null, 2],
  ],
  ...over,
});

const pages = (pdf: Buffer) => (pdf.toString("latin1").match(/\/Type \/Page\b/g) ?? []).length;

describe("renderTablesPdf", () => {
  it("makes a real PDF", () => {
    const pdf = renderTablesPdf({ title: "Daily Report", subtitle: "2026-10-22", tables: [table()] });
    expect(pdf.subarray(0, 5).toString()).toBe("%PDF-");
    expect(pdf.subarray(-6).toString()).toContain("%%EOF");
    expect(pdf.length).toBeGreaterThan(1000);
  });

  it("produces the same bytes every time for the same tables - nothing in it records when it was made", async () => {
    const spec = { title: "Daily Report", subtitle: "2026-10-22", tables: [table()] };
    const a = renderTablesPdf(spec);
    await new Promise((r) => setTimeout(r, 1100)); // past a whole second
    const b = renderTablesPdf(spec);
    expect(a.equals(b)).toBe(true);
  });

  it("changes when a figure changes, so a changed report is never mistaken for an unchanged one", () => {
    const a = renderTablesPdf({ title: "T", tables: [table()] });
    const b = renderTablesPdf({ title: "T", tables: [table({ rows: [["Class A", "A1", "Alpha", 10, 14]] })] });
    expect(a.equals(b)).toBe(false);
  });

  it("runs a long table onto more pages", () => {
    const rows = Array.from({ length: 400 }, (_, i) => ["Class A", `S${i}`, `Product ${i}`, i, i * 2]);
    const long = renderTablesPdf({ title: "T", tables: [table({ rows })] });
    const short = renderTablesPdf({ title: "T", tables: [table()] });
    expect(pages(long)).toBeGreaterThan(pages(short));
    expect(pages(short)).toBe(1);
  });

  it("copes with an empty table, no tables, and awkward text", () => {
    expect(() => renderTablesPdf({ title: "T", tables: [table({ rows: [] })] })).not.toThrow();
    expect(() => renderTablesPdf({ title: "T", tables: [] })).not.toThrow();
    expect(() =>
      renderTablesPdf({
        title: "T",
        tables: [table({ columns: ["Category", "Product", "Off→Ol"], rows: [["Ñandú — «special»", "日本語 \u0000 ( ) \\ and a very long product name that goes on and on and on and on and on", 1]] })],
      }),
    ).not.toThrow();
  });

  it("works for a table without a Category column too", () => {
    const pdf = renderTablesPdf({ title: "T", tables: [{ name: "Summary", columns: ["Item", "Value"], rows: [["Report date", "2026-10-22"], ["Audit counts", 3]] }] });
    expect(pdf.subarray(0, 5).toString()).toBe("%PDF-");
  });
});

describe("pdfText", () => {
  it("swaps symbols the built-in fonts cannot draw for plain ones", () => {
    expect(pdfText("Stocks In (Off→Ol)")).toBe("Stocks In (Off->Ol)");
    expect(pdfText("a — b – c ’s “q” …")).toBe("a - b - c 's \"q\" ...");
  });

  it("keeps Latin-1 letters, shows other scripts as ?, and drops control characters", () => {
    expect(pdfText("Ñandú café")).toBe("Ñandú café");
    expect(pdfText("日本")).toBe("??");
    expect(pdfText("a\u0000b\u0007c")).toBe("abc");
  });
});
