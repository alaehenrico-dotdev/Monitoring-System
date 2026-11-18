import { describe, expect, it } from "vitest";
import { describeJson, humanizeKey, toPlainText } from "./aiText";

describe("toPlainText leaves good answers alone", () => {
  it("returns plain sentences exactly as written", () => {
    const text = "Using 2026-11-01 to 2026-11-17, TOYO MANSI (SKU AFP035) has the most RTS with 42 units.";
    expect(toPlainText(text)).toBe(text);
  });

  it("keeps a bulleted list with - bullets", () => {
    const text = "Running out first:\n- TOYO MANSI: 2 days\n- SOY SAUCE: 3 days";
    expect(toPlainText(text)).toBe(text);
  });

  it("keeps numbers, dates, a minus sign and a percentage untouched", () => {
    const text = "Variance was -12 (down 8.5%) on 2026-11-09; 3 - 1 = 2.";
    expect(toPlainText(text)).toBe(text);
  });

  it("returns an empty answer as empty", () => {
    expect(toPlainText("   ")).toBe("");
  });
});

describe("toPlainText turns JSON into readable lines", () => {
  it("writes an object as one line per field, in words and not field names", () => {
    const out = toPlainText('{"totalOut": 4132, "absVariance": 12.5, "daysLeft": null}');
    expect(out).toBe("total out: 4132\nabs variance: 12.5\ndays left: none");
    expect(out).not.toMatch(/[{}"]/);
  });

  it("writes a list of products as one bullet each, led by the name and SKU", () => {
    const out = toPlainText(
      JSON.stringify([
        { sku: "AFP035", name: "TOYO MANSI", unit: "pcs", rts: 42 },
        { sku: "AFP010", name: "SOY SAUCE", unit: "pcs", rts: 7 },
      ]),
    );
    expect(out).toBe("- TOYO MANSI (AFP035): unit pcs, rts 42\n- SOY SAUCE (AFP010): unit pcs, rts 7");
  });

  it("handles a fenced json block", () => {
    const out = toPlainText('```json\n{"from": "2026-11-01", "to": "2026-11-17"}\n```');
    expect(out).toBe("from: 2026-11-01\nto: 2026-11-17");
  });

  it("handles nested lists of rows inside an object", () => {
    const out = toPlainText(JSON.stringify({ from: "2026-11-01", products: [{ name: "A", totalOut: 5 }] }));
    expect(out).toBe("from: 2026-11-01\nproducts:\n- A: total out 5");
  });

  it("leaves text that merely mentions braces, or is cut-off JSON, readable and brace-free where it can", () => {
    expect(toPlainText("Use {braces} sparingly.")).toBe("Use {braces} sparingly.");
    // Cut off mid-way: not valid JSON, so it is cleaned as text rather than thrown away.
    expect(toPlainText('{"totalOut": 4132, "abs')).toBe('{"totalOut": 4132, "abs');
  });
});

describe("toPlainText removes markdown the screen does not render", () => {
  it("strips bold, headings, code marks and links", () => {
    const out = toPlainText("## Summary\n**TOYO MANSI** has the most `RTS` - see [the report](https://x.test/r).");
    expect(out).toBe("Summary\nTOYO MANSI has the most RTS - see the report.");
  });

  it("turns * and • bullets into - bullets", () => {
    expect(toPlainText("* one\n* two\n• three")).toBe("- one\n- two\n- three");
  });

  it("does not eat a multiplication sign or a lone asterisk in a sentence", () => {
    expect(toPlainText("12 * 3 = 36 units")).toBe("12 * 3 = 36 units");
  });

  it("drops a horizontal rule and collapses blank runs", () => {
    expect(toPlainText("One\n\n\n\n---\n\nTwo")).toBe("One\n\nTwo");
  });

  it("caps a runaway answer", () => {
    const out = toPlainText("word ".repeat(2000));
    expect(out.length).toBeLessThanOrEqual(2501);
    expect(out.endsWith("…")).toBe(true);
  });
});

describe("helpers", () => {
  it("humanizes keys", () => {
    expect(humanizeKey("totalOut")).toBe("total out");
    expect(humanizeKey("days_left")).toBe("days left");
    expect(humanizeKey("consecutiveShortAudits")).toBe("consecutive short audits");
  });

  it("describes scalars and empty values", () => {
    expect(describeJson(5)).toBe("5");
    expect(describeJson([])).toBe("");
    expect(describeJson({})).toBe("");
  });
});
