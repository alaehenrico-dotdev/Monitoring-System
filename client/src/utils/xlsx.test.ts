// @vitest-environment node
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { excelSerialToIso, pickSheetForDate, readXlsx } from "./xlsx";
import { splitCombinedSheet } from "./combinedSheet";
import { findMatchingProduct } from "./importMatch";

/// A tiny stored (uncompressed) zip, enough for the reader.
function zip(files: Record<string, string>): ArrayBuffer {
  const enc = new TextEncoder();
  const chunks: Uint8Array[] = [];
  const central: Uint8Array[] = [];
  let offset = 0;
  const u16 = (n: number) => [n & 255, (n >> 8) & 255];
  const u32 = (n: number) => [n & 255, (n >> 8) & 255, (n >> 16) & 255, (n >>> 24) & 255];
  for (const [name, text] of Object.entries(files)) {
    const nameB = enc.encode(name);
    const data = enc.encode(text);
    const local = new Uint8Array([
      ...u32(0x04034b50), ...u16(20), ...u16(0), ...u16(0), ...u16(0), ...u16(0),
      ...u32(0), ...u32(data.length), ...u32(data.length), ...u16(nameB.length), ...u16(0), ...nameB, ...data,
    ]);
    central.push(
      new Uint8Array([
        ...u32(0x02014b50), ...u16(20), ...u16(20), ...u16(0), ...u16(0), ...u16(0), ...u16(0),
        ...u32(0), ...u32(data.length), ...u32(data.length), ...u16(nameB.length), ...u16(0), ...u16(0),
        ...u16(0), ...u16(0), ...u32(0), ...u32(offset), ...nameB,
      ]),
    );
    chunks.push(local);
    offset += local.length;
  }
  const cd = central.reduce((n, c) => n + c.length, 0);
  const end = new Uint8Array([
    ...u32(0x06054b50), ...u16(0), ...u16(0), ...u16(central.length), ...u16(central.length),
    ...u32(cd), ...u32(offset), ...u16(0),
  ]);
  const all = new Uint8Array(offset + cd + end.length);
  let p = 0;
  for (const c of [...chunks, ...central, end]) {
    all.set(c, p);
    p += c.length;
  }
  return all.buffer;
}

const workbook = (sheets: { name: string; xml: string }[]) =>
  zip({
    "xl/workbook.xml": `<workbook xmlns:r="x"><sheets>${sheets
      .map((s, i) => `<sheet name="${s.name}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`)
      .join("")}</sheets></workbook>`,
    "xl/_rels/workbook.xml.rels": `<Relationships>${sheets
      .map((_, i) => `<Relationship Id="rId${i + 1}" Target="worksheets/sheet${i + 1}.xml"/>`)
      .join("")}</Relationships>`,
    "xl/sharedStrings.xml": `<sst><si><t>Sweet A</t></si><si><r><t>Fish </t></r><r><t>&amp; Co</t></r></si></sst>`,
    ...Object.fromEntries(sheets.map((s, i) => [`xl/worksheets/sheet${i + 1}.xml`, s.xml])),
  });

describe("readXlsx", () => {
  it("reads shared strings, numbers, inline strings and the A1 date", async () => {
    const sheet = `<worksheet><sheetData>
      <row r="1"><c r="A1"><v>46303</v></c></row>
      <row r="2"><c r="A2" t="s"><v>0</v></c><c r="C2"><f>1+1</f><v>283.0</v></c><c r="D2" t="inlineStr"><is><t>x</t></is></c></row>
      <row r="3"><c r="A3" t="s"><v>1</v></c><c r="B3"><v>0.7000000000000001</v></c></row>
    </sheetData></worksheet>`;
    const [s] = await readXlsx(workbook([{ name: " OCT 8", xml: sheet }]));
    expect(s.name).toBe("OCT 8");
    expect(s.date).toBe("2026-10-08");
    expect(s.rows[1]).toEqual(["Sweet A", "", "283", "x"]);
    expect(s.rows[2]).toEqual(["Fish & Co", "0.7"]);
  });

  it("ignores a stray cell far below the data instead of allocating empty rows", async () => {
    const sheet = `<worksheet><sheetData>
      <row r="1"><c r="A1" t="inlineStr"><is><t>top</t></is></c></row>
      <row r="1048576"><c r="A1048576" t="inlineStr"><is><t>far</t></is></c></row>
    </sheetData></worksheet>`;
    const [s] = await readXlsx(workbook([{ name: "S", xml: sheet }]));
    expect(s.rows.length).toBe(1);
    expect(s.rows[0][0]).toBe("top");
  });

  it("rejects non-xlsx input", async () => {
    await expect(readXlsx(new TextEncoder().encode("hello world, not a zip file at all").buffer as ArrayBuffer)).rejects.toThrow(/valid/);
  });

  it("converts Excel serials and picks the sheet for a date", () => {
    expect(excelSerialToIso(46309)).toBe("2026-10-14");
    expect(excelSerialToIso(5)).toBeNull();
    const sheets = [
      { name: "OCT 8", rows: [], date: "2026-10-08" },
      { name: "OCT 9", rows: [], date: "2026-10-09" },
    ];
    expect(pickSheetForDate(sheets, "2026-10-09").name).toBe("OCT 9");
    expect(() => pickSheetForDate(sheets, "2026-10-11")).toThrow(/dated 2026-10-11.*OCT 8/);
    expect(pickSheetForDate([{ name: "Sheet1", rows: [], date: null }], "2026-10-11").name).toBe("Sheet1");
  });
});

const REAL = resolve(__dirname, "../../../10 - CONSOLIDATED STOCKS.xlsx");

describe.skipIf(!existsSync(REAL))("the real consolidated workbook", () => {
  const load = async () => {
    const b = readFileSync(REAL);
    return readXlsx(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer);
  };

  it("has one dated sheet per day", async () => {
    const sheets = await load();
    expect(sheets.map((s) => s.date)).toEqual([
      "2026-10-08", "2026-10-09", "2026-10-10", "2026-10-12", "2026-10-13", "2026-10-14",
    ]);
  });

  it("rebuilds the OFFLINE table for Oct 8 with the right figures", async () => {
    const sheet = pickSheetForDate(await load(), "2026-10-08");
    const out = splitCombinedSheet(sheet.rows, "OFFLINE");
    expect(out.layout).toBe("side-by-side");
    expect(out.table[0]).toEqual([
      "Product", "Stocks (Opening)", "Production (In)", "Backloads", "Delivery (Out)",
      "Ending Final Stocks", "Manual Count", "Variances",
    ]);
    const fish = out.table.find((r) => r[0] === "FISH SAUCE")!;
    expect(fish.slice(1)).toEqual(["156", "", "24", "0", "180", "156", "-24"]);
    // Category headings are bare names; the totals row and footer are gone.
    expect(out.table.filter((r) => r.length === 1).map((r) => r[0])).toContain("CLASS A -(LITER)");
    expect(out.table.some((r) => /variance:|total out/i.test(r[0]))).toBe(false);
    const categories = out.table.filter((r) => r.length === 1);
    expect(categories).toHaveLength(6);
    expect(out.table.length - 1 - categories.length).toBe(56); // products
  });

  it("rebuilds the ONLINE table (blocks are told apart by position)", async () => {
    const sheet = pickSheetForDate(await load(), "2026-10-08");
    const out = splitCombinedSheet(sheet.rows, "ONLINE");
    expect(out.table[0]).toContain("RTS");
    const special = out.table.filter((r) => r[0] === "SPECIAL A")[0];
    // Beginning 399, prod -, RTS 7, fulfilment 97, ending 309, manual 399, variance 90
    expect(special.slice(1)).toEqual(["399", "", "7", "97", "309", "399", "90"]);
  });

  it("reads the extra sales-agent column on the Oct 12 sheet without shifting the blocks", async () => {
    const sheet = pickSheetForDate(await load(), "2026-10-12");
    const off = splitCombinedSheet(sheet.rows, "OFFLINE").table.find((r) => r[0] === "SPECIAL")!;
    expect(off.slice(1, 6)).toEqual(["194", "", "", "12", "182"]);
    const on = splitCombinedSheet(sheet.rows, "ONLINE").table.find((r) => r[0] === "SPECIAL")!;
    expect(on[1]).toBe("0");
  });

  it("matches product names strictly, using the category rows to tell same-named SKUs apart", async () => {
    const sheet = pickSheetForDate(await load(), "2026-10-08");
    let category = "";
    const rows: { product: { name: string; category: string } }[] = [];
    for (const r of splitCombinedSheet(sheet.rows, "OFFLINE").table.slice(1)) {
      if (r.length === 1) category = r[0];
      else rows.push({ product: { name: r[0], category } });
    }
    // "SPECIAL" exists in several categories: unresolvable without one...
    expect(findMatchingProduct(rows, "Special", undefined)).toBeUndefined();
    // ...and resolves with it (the category match is the looser heading match).
    expect(findMatchingProduct(rows, "special", "Premium (350 ML)")?.product.category).toBe("PREMIUM (350 ML)");
    // Near misses are not matches.
    expect(findMatchingProduct(rows, "Sweet-A", "CLASS A -(LITER)")).toBeUndefined();
    expect(findMatchingProduct(rows, "Sweet A2", "CLASS A -(LITER)")).toBeUndefined();
    expect(findMatchingProduct(rows, "  SWEET   A ", "CLASS A -(LITER)")?.product.name).toBe("SWEET A");
  });
});

describe.skipIf(!existsSync(REAL))("product list from the real workbook", () => {
  it("lists every product in the sheet's order under its category", async () => {
    const b = readFileSync(REAL);
    const sheets = await readXlsx(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer);
    for (const sheet of sheets) {
      const split = splitCombinedSheet(sheet.rows, "OFFLINE");
      const products = split.products!;
      expect(products.length).toBe(56);
      expect(products[0]).toEqual({ category: "PREMIUM (350 ML)", name: "SPECIAL" });
      expect(products.at(-1)).toEqual({ category: "Other PRODUCTS", name: "NSC TOYOMANSI" });
      // Both blocks share column A, so the list is the same for either location.
      expect(splitCombinedSheet(sheet.rows, "ONLINE").products).toEqual(products);
    }
  });
});
