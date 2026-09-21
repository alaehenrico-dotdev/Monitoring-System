import { describe, expect, it } from "vitest";
import { parseCsv, toCsv } from "./csv";

describe("toCsv", () => {
  it("joins headers and rows with CRLF, comma-separated", () => {
    expect(toCsv(["A", "B"], [["1", "2"]])).toBe("A,B\r\n1,2");
  });

  it("quotes a field containing a comma, quote, or newline", () => {
    expect(toCsv(["Name"], [['Sweet, "A"']])).toBe('Name\r\n"Sweet, ""A"""');
    expect(toCsv(["Name"], [["line1\nline2"]])).toBe('Name\r\n"line1\nline2"');
  });

  it("leaves plain fields unquoted", () => {
    expect(toCsv(["Name"], [["Sweet A"]])).toBe("Name\r\nSweet A");
  });
});

describe("parseCsv", () => {
  it("parses a simple comma-separated grid", () => {
    expect(parseCsv("A,B\n1,2")).toEqual([
      ["A", "B"],
      ["1", "2"],
    ]);
  });

  it("handles CRLF and bare LF line endings the same way", () => {
    expect(parseCsv("A,B\r\n1,2\r\n")).toEqual([
      ["A", "B"],
      ["1", "2"],
    ]);
    expect(parseCsv("A,B\n1,2\n")).toEqual([
      ["A", "B"],
      ["1", "2"],
    ]);
  });

  it("unescapes a doubled-quote inside a quoted field", () => {
    expect(parseCsv('Name\r\n"Sweet, ""A"""')).toEqual([["Name"], ['Sweet, "A"']]);
  });

  it("keeps an embedded newline inside a quoted field as one cell", () => {
    expect(parseCsv('Name\r\n"line1\nline2"')).toEqual([["Name"], ["line1\nline2"]]);
  });

  it("drops fully-blank lines instead of returning an empty row", () => {
    expect(parseCsv("A,B\n1,2\n\n\n3,4")).toEqual([
      ["A", "B"],
      ["1", "2"],
      ["3", "4"],
    ]);
  });

  it("still captures the final row when the file has no trailing newline", () => {
    expect(parseCsv("A,B\n1,2")).toEqual([
      ["A", "B"],
      ["1", "2"],
    ]);
  });

  it("round-trips through toCsv for values that need quoting", () => {
    const headers = ["Category", "Product"];
    const rows: (string | number)[][] = [
      ['Class A, "Gallon"', "Sweet A"],
      ["Class B", 'Toyo Mansi\n(2nd batch)'],
    ];
    expect(parseCsv(toCsv(headers, rows))).toEqual([headers, ...rows.map((r) => r.map(String))]);
  });
});
