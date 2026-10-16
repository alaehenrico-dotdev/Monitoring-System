/**
 * Minimal .xlsx reader for the import dialog: every sheet as a grid of
 * strings, the same shape parseCsv gives, so a workbook goes through the same
 * matching/review code as a CSV.
 *
 * No library, matching csv.ts and excel.ts: an .xlsx is a zip of XML parts, and
 * all that is needed is the cached value of each cell. Inflating uses the
 * browser's built-in DecompressionStream (Chrome/Edge/Firefox/Safari and
 * Node 18+), so nothing is added to the bundle and the strict production CSP
 * is untouched. Formulas are never evaluated - the value Excel last saved is
 * read, which is what a person sees in the cell.
 */

export interface XlsxSheet {
  name: string;
  rows: string[][];
  /// "YYYY-MM-DD" when cell A1 holds a date (the consolidated stock workbook
  /// puts the day there), else null.
  date: string | null;
}

/// Refuse oversized input before inflating anything (zip bombs / wrong file).
export const MAX_XLSX_BYTES = 15 * 1024 * 1024;
const MAX_PART_BYTES = 40 * 1024 * 1024;

interface ZipEntry {
  method: number;
  compressedSize: number;
  size: number;
  offset: number;
}

const u16 = (v: DataView, o: number) => v.getUint16(o, true);
const u32 = (v: DataView, o: number) => v.getUint32(o, true);

function readCentralDirectory(buf: Uint8Array): Map<string, ZipEntry> {
  const view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  // End-of-central-directory record: scan back from the end (it may be
  // followed by a comment of up to 64 KiB).
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 22 - 65535); i--) {
    if (u32(view, i) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd === -1) throw new Error("This is not a valid .xlsx file");
  const count = u16(view, eocd + 10);
  let p = u32(view, eocd + 16);
  const entries = new Map<string, ZipEntry>();
  const decoder = new TextDecoder();
  for (let n = 0; n < count; n++) {
    if (p + 46 > buf.length || u32(view, p) !== 0x02014b50) throw new Error("The .xlsx file is damaged");
    const nameLen = u16(view, p + 28);
    const extraLen = u16(view, p + 30);
    const commentLen = u16(view, p + 32);
    const name = decoder.decode(buf.subarray(p + 46, p + 46 + nameLen));
    entries.set(name, {
      method: u16(view, p + 10),
      compressedSize: u32(view, p + 20),
      size: u32(view, p + 24),
      offset: u32(view, p + 42),
    });
    p += 46 + nameLen + extraLen + commentLen;
  }
  return entries;
}

async function readPart(buf: Uint8Array, entry: ZipEntry): Promise<string> {
  if (entry.size > MAX_PART_BYTES) throw new Error("The .xlsx file is too large to read");
  const view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  const o = entry.offset;
  if (u32(view, o) !== 0x04034b50) throw new Error("The .xlsx file is damaged");
  const start = o + 30 + u16(view, o + 26) + u16(view, o + 28);
  const data = buf.subarray(start, start + entry.compressedSize);
  if (entry.method === 0) return new TextDecoder().decode(data);
  if (entry.method !== 8) throw new Error("Unsupported compression in the .xlsx file");
  if (typeof DecompressionStream === "undefined") {
    throw new Error("This browser cannot open .xlsx files - save the sheet as CSV instead");
  }
  const stream = new Blob([data as BlobPart]).stream().pipeThrough(new DecompressionStream("deflate-raw"));
  const out = new Uint8Array(await new Response(stream).arrayBuffer());
  if (out.length > MAX_PART_BYTES) throw new Error("The .xlsx file is too large to read");
  return new TextDecoder().decode(out);
}

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" };
function decodeXml(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos);/gi, (_, e: string) => {
    if (e[0] === "#") {
      const code = e[1].toLowerCase() === "x" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return Number.isFinite(code) ? String.fromCodePoint(code) : "";
    }
    return ENTITIES[e.toLowerCase()] ?? "";
  });
}

/// All <t> text of one rich-text/plain string item (phonetic runs excluded).
function textOf(xml: string): string {
  const stripped = xml.replace(/<rPh\b[\s\S]*?<\/rPh>/g, "");
  let out = "";
  for (const m of stripped.matchAll(/<t\b[^>]*>([\s\S]*?)<\/t>/g)) out += m[1];
  return decodeXml(out);
}

function parseSharedStrings(xml: string): string[] {
  return [...xml.matchAll(/<si\b[^>]*>([\s\S]*?)<\/si>/g)].map((m) => textOf(m[1]));
}

function colIndex(ref: string): number {
  let n = 0;
  for (const ch of ref.replace(/[^A-Z]/gi, "").toUpperCase()) n = n * 26 + ch.charCodeAt(0) - 64;
  return n - 1;
}

/// A numeric cell as the text a person would type: "283.0" -> "283", and float
/// noise from a formula (0.7000000000000001) is trimmed.
function numberText(raw: string): string {
  const n = Number(raw);
  return Number.isFinite(n) ? String(parseFloat(n.toPrecision(12))) : raw;
}

const MAX_COLS = 200;
/// A stray cell far down a sheet must not make the reader allocate a million
/// empty rows; stock sheets are a few hundred rows long.
const MAX_ROWS = 5000;

/// The text a cell shows: its cached value, whatever the cell type.
function cellText(attrs: string, body: string, shared: string[]): string {
  const type = /\bt="(\w+)"/.exec(attrs)?.[1] ?? "n";
  const v = /<v\b[^>]*>([\s\S]*?)<\/v>/.exec(body)?.[1];
  if (type === "inlineStr") return textOf(body);
  if (v === undefined) return "";
  if (type === "s") return shared[Number(v)] ?? "";
  if (type === "str" || type === "e") return decodeXml(v);
  if (type === "b") return v === "1" ? "TRUE" : "FALSE";
  return numberText(v);
}

function parseSheet(xml: string, shared: string[]): string[][] {
  const rows: string[][] = [];
  for (const rowMatch of xml.matchAll(/<row\b([^>]*?)(?:\/>|>([\s\S]*?)<\/row>)/g)) {
    const rowNo = Number(/\br="(\d+)"/.exec(rowMatch[1])?.[1] ?? rows.length + 1);
    if (!rowMatch[2] || rowNo > MAX_ROWS) continue;
    const cells: string[] = [];
    for (const c of rowMatch[2].matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
      const ref = /\br="([A-Z]+\d+)"/.exec(c[1])?.[1];
      if (!ref || !c[2]) continue;
      const col = colIndex(ref);
      if (col < 0 || col >= MAX_COLS) continue;
      while (cells.length <= col) cells.push("");
      cells[col] = cellText(c[1], c[2], shared);
    }
    if (cells.some((x) => x !== "")) {
      while (rows.length < rowNo - 1) rows.push([]);
      rows[rowNo - 1] = cells;
    }
  }
  return rows;
}

/// Excel date serial -> "YYYY-MM-DD" (1900 date system, which every modern
/// workbook uses). Null for anything that is not a plausible 2000-2100 date.
export function excelSerialToIso(serial: number): string | null {
  if (!Number.isFinite(serial) || serial < 36526 || serial > 73050) return null;
  return new Date(Date.UTC(1899, 11, 30) + Math.floor(serial) * 86_400_000).toISOString().slice(0, 10);
}

/// Opens the zip and resolves the visible sheets to their XML parts.
async function openWorkbook(data: ArrayBuffer) {
  if (data.byteLength > MAX_XLSX_BYTES) throw new Error("That file is too large to import");
  const buf = new Uint8Array(data);
  const entries = readCentralDirectory(buf);
  const part = async (name: string) => {
    const e = entries.get(name);
    return e ? readPart(buf, e) : null;
  };

  const workbook = await part("xl/workbook.xml");
  const relsXml = await part("xl/_rels/workbook.xml.rels");
  if (!workbook || !relsXml) throw new Error("This is not a valid .xlsx file");
  const targets = new Map<string, string>();
  for (const m of relsXml.matchAll(/<Relationship\b([^>]*)\/?>/g)) {
    const id = /\bId="([^"]+)"/.exec(m[1])?.[1];
    const target = /\bTarget="([^"]+)"/.exec(m[1])?.[1];
    if (id && target) targets.set(id, target.startsWith("/") ? target.slice(1) : `xl/${target}`);
  }
  const sharedXml = await part("xl/sharedStrings.xml");
  const shared = sharedXml ? parseSharedStrings(sharedXml) : [];

  const sheets: { name: string; xml: string }[] = [];
  for (const m of workbook.matchAll(/<sheet\b([^>]*)\/?>/g)) {
    if (/\bstate="(hidden|veryHidden)"/.test(m[1])) continue;
    const name = decodeXml(/\bname="([^"]*)"/.exec(m[1])?.[1] ?? "").trim();
    const rid = /\br:id="([^"]+)"/.exec(m[1])?.[1];
    const path = rid ? targets.get(rid) : undefined;
    const xml = path ? await part(path) : null;
    if (xml) sheets.push({ name, xml });
  }
  if (sheets.length === 0) throw new Error("The workbook has no sheets");
  return { sheets, shared, styles: await part("xl/styles.xml") };
}

export async function readXlsx(data: ArrayBuffer): Promise<XlsxSheet[]> {
  const { sheets: parts, shared } = await openWorkbook(data);
  return parts.map(({ name, xml }) => {
    const rows = parseSheet(xml, shared);
    const a1 = rows[0]?.[0] ?? "";
    return { name, rows, date: /^\d+(\.\d+)?$/.test(a1) ? excelSerialToIso(Number(a1)) : null };
  });
}

/// One cell of a sheet's first column with the formatting a person reads it by.
export interface XlsxStyledCell {
  /// 1-based sheet row.
  row: number;
  text: string;
  bold: boolean;
  /// Font size in points (11 when the file does not say).
  size: number;
}

export interface XlsxStyledSheet {
  name: string;
  /// Non-empty cells of column A, top to bottom.
  cells: XlsxStyledCell[];
}

/// Per cell format (the `s` index on a cell): is its font bold, and how big.
function parseCellFormats(xml: string | null): { bold: boolean; size: number }[] {
  if (!xml) return [];
  const fontsXml = /<fonts\b[\s\S]*?<\/fonts>/.exec(xml)?.[0] ?? "";
  const fonts = [...fontsXml.matchAll(/<font\b(?!s)([^>]*?)(?:\/>|>([\s\S]*?)<\/font>)/g)].map((m) => {
    const body = m[2] ?? "";
    // <b/> or <b val="1"/> is bold; <b val="0"/> explicitly is not.
    const b = /<b\b([^>]*)\/?>/.exec(body);
    const bold = !!b && !/\bval="(0|false)"/.test(b[1]);
    const size = Number(/<sz\b[^>]*\bval="([\d.]+)"/.exec(body)?.[1]);
    return { bold, size: Number.isFinite(size) && size > 0 ? size : 11 };
  });
  const xfsXml = /<cellXfs\b[\s\S]*?<\/cellXfs>/.exec(xml)?.[0] ?? "";
  return [...xfsXml.matchAll(/<xf\b([^>]*?)(?:\/>|>[\s\S]*?<\/xf>)/g)].map((m) => {
    const fontId = Number(/\bfontId="(\d+)"/.exec(m[1])?.[1] ?? 0);
    return fonts[fontId] ?? { bold: false, size: 11 };
  });
}

/// Column A of every visible sheet with each cell's bold flag and font size -
/// what a layout template (e.g. the product order sheet, where categories are
/// big bold headings and products are plain-size bold lines) is read from.
export async function readXlsxColumnA(data: ArrayBuffer): Promise<XlsxStyledSheet[]> {
  const { sheets: parts, shared, styles } = await openWorkbook(data);
  const formats = parseCellFormats(styles);
  return parts.map(({ name, xml }) => {
    const cells: XlsxStyledCell[] = [];
    for (const m of xml.matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
      const ref = /\br="([A-Z]+)(\d+)"/.exec(m[1]);
      if (!ref || ref[1] !== "A" || !m[2]) continue;
      const row = Number(ref[2]);
      const text = cellText(m[1], m[2], shared).replace(/\s+/g, " ").trim();
      if (text === "" || row > MAX_ROWS) continue;
      const format = formats[Number(/\bs="(\d+)"/.exec(m[1])?.[1] ?? 0)] ?? { bold: false, size: 11 };
      cells.push({ row, text, bold: format.bold, size: format.size });
    }
    return { name, cells };
  });
}

/// The sheet to import for `date`: the one whose A1 date matches. A workbook
/// with a single sheet and no date in it is used as is; anything else that
/// does not match is an error naming what the file has, rather than a guess -
/// importing another day's sheet would silently seed the wrong numbers.
export function pickSheetForDate(sheets: XlsxSheet[], date: string | undefined): XlsxSheet {
  if (date) {
    const hit = sheets.find((s) => s.date === date);
    if (hit) return hit;
  }
  if (sheets.length === 1 && sheets[0].date === null) return sheets[0];
  const found = sheets.map((s) => (s.date ? `${s.name} (${s.date})` : s.name)).join(", ");
  throw new Error(
    date
      ? `No sheet in this workbook is dated ${date}. Sheets found: ${found}. Change the import date to one of them.`
      : `This workbook has several sheets (${found}); choose the import date first.`,
  );
}
