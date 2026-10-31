import { randomBytes } from "node:crypto";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { describe, expect, it } from "vitest";
import { BackupCryptoError, createBackupDecryptor, createBackupEncryptor, isEncryptedBackupHead, parseBackupKey } from "./backupCrypto";

const key = randomBytes(32);

async function run(input: Buffer[], ...stages: NodeJS.ReadWriteStream[]): Promise<Buffer> {
  const out: Buffer[] = [];
  const sink = new (await import("node:stream")).Writable({ write: (c, _e, cb) => (out.push(c), cb()) });
  await pipeline([Readable.from(input), ...stages, sink] as never);
  return Buffer.concat(out);
}

const encrypt = (data: Buffer, pieces = 1) => {
  const size = Math.max(1, Math.ceil(data.length / pieces));
  const parts: Buffer[] = [];
  for (let i = 0; i < data.length; i += size) parts.push(data.subarray(i, i + size));
  return run(parts.length ? parts : [Buffer.alloc(0)], createBackupEncryptor(key));
};

// Re-chunks `data` to exercise every chunk boundary the decryptor can see.
const decrypt = (data: Buffer, step: number, k: Buffer | null = key, lenient = false) => {
  const parts: Buffer[] = [];
  for (let i = 0; i < data.length; i += step) parts.push(data.subarray(i, i + step));
  return run(parts, createBackupDecryptor(k, { lenient }));
};

describe("backup encryption", () => {
  it("round-trips sizes around the frame boundary and an empty file", async () => {
    for (const size of [0, 1, 65535, 65536, 65537, 65536 * 3, 200_000]) {
      const data = randomBytes(size);
      const enc = await encrypt(data, 3);
      expect(isEncryptedBackupHead(enc)).toBe(true);
      expect((await decrypt(enc, 1000)).equals(data)).toBe(true);
    }
  });

  it("decrypts when chunks end exactly on a frame boundary", async () => {
    const data = randomBytes(65536 * 2 + 10);
    const enc = await encrypt(data);
    const frame = 4 + 65536 + 16;
    expect((await decrypt(enc, 28 + frame)).equals(data)).toBe(true);
    expect((await decrypt(enc, 997)).equals(data)).toBe(true);
  });

  it("never writes the plaintext and differs on every run", async () => {
    const data = Buffer.from("INSERT INTO users VALUES ('admin','$2b$10$hash');".repeat(50));
    const a = await encrypt(data);
    const b = await encrypt(data);
    expect(a.includes("INSERT INTO")).toBe(false);
    expect(a.equals(b)).toBe(false);
  });

  it("rejects a wrong key, a flipped bit, a cut-short file and trailing data", async () => {
    const enc = await encrypt(randomBytes(150_000));
    await expect(decrypt(enc, 5000, randomBytes(32))).rejects.toThrow(BackupCryptoError);
    const flipped = Buffer.from(enc);
    flipped[flipped.length - 40] ^= 1;
    await expect(decrypt(flipped, 5000)).rejects.toThrow(BackupCryptoError);
    await expect(decrypt(enc.subarray(0, enc.length - 100), 5000)).rejects.toThrow(BackupCryptoError);
    await expect(decrypt(enc.subarray(0, 28 + 4 + 65536 + 16), 5000)).rejects.toThrow(BackupCryptoError);
    await expect(decrypt(Buffer.concat([enc, Buffer.from("x")]), 5000)).rejects.toThrow(BackupCryptoError);
  });

  it("reports a bad file as a client error (400), never a server fault", async () => {
    const enc = await encrypt(randomBytes(1000));
    await expect(decrypt(enc, 100, randomBytes(32))).rejects.toMatchObject({ status: 400 });
    await expect(decrypt(enc.subarray(0, enc.length - 5), 100)).rejects.toMatchObject({ status: 400 });
  });

  it("rejects reordered frames", async () => {
    const enc = await encrypt(randomBytes(65536 * 3));
    const frame = 4 + 65536 + 16;
    const body = enc.subarray(28);
    const swapped = Buffer.concat([enc.subarray(0, 28), body.subarray(frame, 2 * frame), body.subarray(0, frame), body.subarray(2 * frame)]);
    await expect(decrypt(swapped, 9000)).rejects.toThrow(BackupCryptoError);
  });

  it("needs the key for encrypted files and passes plain ones only when lenient", async () => {
    const enc = await encrypt(Buffer.from("-- MySQL dump"));
    await expect(decrypt(enc, 100, null, true)).rejects.toThrow(/not set/);
    const plain = Buffer.from("-- MySQL dump 10.13\nSELECT 1;\n");
    expect((await decrypt(plain, 7, key, true)).equals(plain)).toBe(true);
    expect((await decrypt(Buffer.from("-- M"), 1, key, true)).toString()).toBe("-- M");
    await expect(decrypt(plain, 7, key, false)).rejects.toThrow(/not an encrypted backup/);
  });

  it("accepts only a real 32-byte key", () => {
    expect(parseBackupKey(randomBytes(32).toString("base64"))).toHaveLength(32);
    expect(parseBackupKey(randomBytes(32).toString("hex"))).toHaveLength(32);
    expect(() => parseBackupKey("hunter2")).toThrow(BackupCryptoError);
    expect(() => parseBackupKey("A".repeat(43) + "=")).toThrow(BackupCryptoError);
  });
});
