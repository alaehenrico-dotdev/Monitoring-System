/**
 * A minimal ZIP writer (no compression - "stored" entries), enough to bundle
 * a few already-compressed PDFs and a database dump into ONE download, so the
 * browser/desktop shell asks to save once instead of once per file. Written
 * by hand rather than adding a dependency for ~80 lines.
 */

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(bytes: Uint8Array): number {
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i++)
    c = CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function dosDateTime(d: Date): { time: number; date: number } {
  const year = Math.max(1980, d.getFullYear());
  return {
    time:
      (d.getHours() << 11) |
      (d.getMinutes() << 5) |
      Math.floor(d.getSeconds() / 2),
    date: ((year - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate(),
  };
}

export interface ZipInput {
  name: string;
  data: Blob;
}

export async function createZip(files: ZipInput[]): Promise<Blob> {
  const encoder = new TextEncoder();
  const { time, date } = dosDateTime(new Date());
  const parts: BlobPart[] = [];
  const central: BlobPart[] = [];
  let centralSize = 0;
  let offset = 0;

  for (const file of files) {
    const bytes = new Uint8Array(await file.data.arrayBuffer());
    const name = encoder.encode(file.name);
    const crc = crc32(bytes);

    const local = new Uint8Array(new ArrayBuffer(30 + name.length));
    const lv = new DataView(local.buffer);
    lv.setUint32(0, 0x04034b50, true);
    lv.setUint16(4, 20, true); // version needed
    lv.setUint16(6, 0x0800, true); // UTF-8 file names
    lv.setUint16(8, 0, true); // stored
    lv.setUint16(10, time, true);
    lv.setUint16(12, date, true);
    lv.setUint32(14, crc, true);
    lv.setUint32(18, bytes.length, true);
    lv.setUint32(22, bytes.length, true);
    lv.setUint16(26, name.length, true);
    lv.setUint16(28, 0, true);
    local.set(name, 30);

    const entry = new Uint8Array(new ArrayBuffer(46 + name.length));
    const ev = new DataView(entry.buffer);
    ev.setUint32(0, 0x02014b50, true);
    ev.setUint16(4, 20, true); // version made by
    ev.setUint16(6, 20, true); // version needed
    ev.setUint16(8, 0x0800, true);
    ev.setUint16(10, 0, true);
    ev.setUint16(12, time, true);
    ev.setUint16(14, date, true);
    ev.setUint32(16, crc, true);
    ev.setUint32(20, bytes.length, true);
    ev.setUint32(24, bytes.length, true);
    ev.setUint16(28, name.length, true);
    ev.setUint32(42, offset, true);
    entry.set(name, 46);

    parts.push(local, bytes);
    central.push(entry);
    centralSize += entry.length;
    offset += local.length + bytes.length;
  }

  const end = new Uint8Array(new ArrayBuffer(22));
  const dv = new DataView(end.buffer);
  dv.setUint32(0, 0x06054b50, true);
  dv.setUint16(8, files.length, true);
  dv.setUint16(10, files.length, true);
  dv.setUint32(12, centralSize, true);
  dv.setUint32(16, offset, true);

  return new Blob([...parts, ...central, end], { type: "application/zip" });
}
