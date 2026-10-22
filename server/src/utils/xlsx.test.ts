import { inflateRawSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import { buildXlsx, columnLetter, crc32, sheetName, zip } from "./xlsx";

/// Reads the zip back with the same rules a reader follows: the central
/// directory first, then each entry's bytes, checking sizes and CRC.
function unzip(buf: Buffer): Map<string, string> {
  const end = buf.length - 22;
  expect(buf.readUInt32LE(end)).toBe(0x06054b50);
  const count = buf.readUInt16LE(end + 10);
  let p = buf.readUInt32LE(end + 16);
  const out = new Map<string, string>();
  for (let i = 0; i < count; i++) {
    expect(buf.readUInt32LE(p)).toBe(0x02014b50);
    const crc = buf.readUInt32LE(p + 16);
    const csize = buf.readUInt32LE(p + 20);
    const usize = buf.readUInt32LE(p + 24);
    const nameLen = buf.readUInt16LE(p + 28);
    const local = buf.readUInt32LE(p + 42);
    const name = buf.subarray(p + 46, p + 46 + nameLen).toString("utf8");
    expect(buf.readUInt32LE(local)).toBe(0x04034b50);
    const start = local + 30 + buf.readUInt16LE(local + 26) + buf.readUInt16LE(local + 28);
    const data = inflateRawSync(buf.subarray(start, start + csize));
    expect(data.length).toBe(usize);
    expect(crc32(data)).toBe(crc);
    out.set(name, data.toString("utf8"));
    p += 46 + nameLen;
  }
  return out;
}

describe("crc32", () => {
  it("matches the standard check value", () => {
    expect(crc32(Buffer.from("123456789"))).toBe(0xcbf43926);
  });
});

describe("zip", () => {
  it("round-trips several files, with UTF-8 names", () => {
    const files = unzip(zip([{ name: "a.txt", data: Buffer.from("hello") }, { name: "ñ/b.txt", data: Buffer.from("x".repeat(5000)) }]));
    expect([...files.keys()]).toEqual(["a.txt", "ñ/b.txt"]);
    expect(files.get("a.txt")).toBe("hello");
    expect(files.get("ñ/b.txt")).toHaveLength(5000);
  });
});

describe("columnLetter / sheetName", () => {
  it("counts like a spreadsheet", () => {
    expect([0, 25, 26, 27, 701, 702].map(columnLetter)).toEqual(["A", "Z", "AA", "AB", "ZZ", "AAA"]);
  });

  it("applies Excel's name rules and keeps names unique", () => {
    const taken = new Set<string>();
    expect(sheetName("Online/Offline: [all]?", taken)).toBe("OnlineOffline all");
    expect(sheetName("online/offline all", taken)).toBe("onlineoffline all 2"); // a clash ignores case, as Excel does
    expect(sheetName("x".repeat(40), taken)).toHaveLength(31);
    expect(sheetName("???", taken)).toBe("Sheet");
  });
});

describe("buildXlsx", () => {
  it("writes the parts Excel needs, with numbers as numbers and text escaped", () => {
    const files = unzip(
      buildXlsx([
        { name: "Online", columns: ["Product", "Remaining"], rows: [["Soy <&> \"sauce\"", 12.5], ["Vinegar", 0], ["Blank", null]], boldRows: [1] },
        { name: "Daily Out", columns: ["Total"], rows: [[7]] },
      ]),
    );
    expect([...files.keys()]).toEqual([
      "[Content_Types].xml",
      "_rels/.rels",
      "xl/workbook.xml",
      "xl/_rels/workbook.xml.rels",
      "xl/styles.xml",
      "xl/worksheets/sheet1.xml",
      "xl/worksheets/sheet2.xml",
    ]);
    expect(files.get("xl/workbook.xml")).toContain('<sheet name="Online" sheetId="1" r:id="rId1"/>');
    expect(files.get("xl/workbook.xml")).toContain('<sheet name="Daily Out" sheetId="2" r:id="rId2"/>');
    const s1 = files.get("xl/worksheets/sheet1.xml")!;
    expect(s1).toContain("Soy &lt;&amp;&gt; &quot;sauce&quot;");
    expect(s1).toContain('<c r="B2" s="2"><v>12.5</v></c>');
    expect(s1).toContain('<c r="B3" s="3"><v>0</v></c>'); // a real zero is kept, in bold on row 1 of boldRows
    expect(s1).not.toContain('r="B4"'); // an empty cell is left out, not written as 0
    expect(s1).toContain('state="frozen"');
  });

  it("drops characters XML cannot carry", () => {
    const files = unzip(buildXlsx([{ name: "S", columns: ["A"], rows: [["bad\u0000\u0008char"]] }]));
    expect(files.get("xl/worksheets/sheet1.xml")).toContain(">badchar<");
  });

  it("refuses a workbook with no sheets", () => {
    expect(() => buildXlsx([])).toThrow(/at least one sheet/);
  });
});
