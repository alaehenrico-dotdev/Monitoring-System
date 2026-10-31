import {
  createCipheriv,
  createDecipheriv,
  hkdfSync,
  randomBytes,
} from "node:crypto";
import { Transform, type TransformCallback } from "node:stream";
import { HttpError } from "./HttpError";

/// Encrypted backup container ("ALAEBK01"), streamed so a dump is never held whole:
///
///   header  magic(8) | fileSalt(16) | noncePrefix(4)
///   frames  repeated: length(4, big-endian) | ciphertext | gcmTag(16)
///
/// Each file gets its own AES-256 key (HKDF of the master key and fileSalt), and
/// every frame is an AES-256-GCM message whose nonce is noncePrefix + a frame
/// counter. The header, the counter and a "last frame" flag are authenticated, so
/// a wrong key, a flipped bit, reordered frames or a file cut short all fail to
/// decrypt instead of producing a quietly damaged dump. The final frame is always
/// written (empty if need be): that is how a truncated file is told from a whole one.
export const BACKUP_MAGIC = Buffer.from("ALAEBK01", "ascii");

const SALT_BYTES = 16;
const PREFIX_BYTES = 4;
const TAG_BYTES = 16;
const HEADER_BYTES = BACKUP_MAGIC.length + SALT_BYTES + PREFIX_BYTES;
const FRAME_BYTES = 64 * 1024;
const INFO = Buffer.from("ala-eh backup file key v1", "ascii");

/// A wrong key, a damaged or tampered file: the caller sent something unusable (400), not a server fault.
export class BackupCryptoError extends HttpError {
  constructor(message: string) {
    super(400, message);
  }
}

/// Master key as set in BACKUP_ENCRYPTION_KEY: 32 random bytes, base64 or 64 hex
/// characters (`openssl rand -base64 32`). A passphrase is refused on purpose: a
/// human-chosen string is exactly what an offline guess attack goes after.
export function parseBackupKey(raw: string): Buffer {
  const text = raw.trim();
  const key = /^[0-9a-f]{64}$/i.test(text)
    ? Buffer.from(text, "hex")
    : Buffer.from(text, "base64");
  if (key.length !== 32 || key.every((b) => b === key[0])) {
    throw new BackupCryptoError(
      "BACKUP_ENCRYPTION_KEY must be 32 random bytes as base64 or hex. Generate one with: openssl rand -base64 32",
    );
  }
  return key;
}

export function isEncryptedBackupHead(head: Buffer): boolean {
  return (
    head.length >= BACKUP_MAGIC.length &&
    head.subarray(0, BACKUP_MAGIC.length).equals(BACKUP_MAGIC)
  );
}

function fileKey(masterKey: Buffer, salt: Buffer): Buffer {
  return Buffer.from(hkdfSync("sha256", masterKey, salt, INFO, 32));
}

function frameNonce(prefix: Buffer, counter: number): Buffer {
  const nonce = Buffer.alloc(12);
  prefix.copy(nonce, 0);
  nonce.writeBigUInt64BE(BigInt(counter), PREFIX_BYTES);
  return nonce;
}

function frameAad(header: Buffer, counter: number, last: boolean): Buffer {
  const tail = Buffer.alloc(9);
  tail.writeBigUInt64BE(BigInt(counter), 0);
  tail[8] = last ? 1 : 0;
  return Buffer.concat([header, tail]);
}

export function createBackupEncryptor(masterKey: Buffer): Transform {
  const salt = randomBytes(SALT_BYTES);
  const prefix = randomBytes(PREFIX_BYTES);
  const header = Buffer.concat([BACKUP_MAGIC, salt, prefix]);
  const key = fileKey(masterKey, salt);
  let pending: Buffer = Buffer.alloc(0);
  let counter = 0;
  let headerSent = false;

  const seal = (plain: Buffer, last: boolean): Buffer => {
    const cipher = createCipheriv(
      "aes-256-gcm",
      key,
      frameNonce(prefix, counter),
      { authTagLength: TAG_BYTES },
    );
    cipher.setAAD(frameAad(header, counter, last));
    const body = Buffer.concat([cipher.update(plain), cipher.final()]);
    counter += 1;
    const length = Buffer.alloc(4);
    length.writeUInt32BE(body.length, 0);
    return Buffer.concat([length, body, cipher.getAuthTag()]);
  };
  const withHeader = (out: Buffer[]): Buffer[] => {
    if (headerSent) return out;
    headerSent = true;
    return [header, ...out];
  };

  return new Transform({
    transform(chunk: Buffer, _enc: string, done: TransformCallback) {
      try {
        pending = Buffer.concat([pending, chunk]);
        const out: Buffer[] = [];
        // Keep at least one byte back, so the last frame can be flagged as last.
        while (pending.length > FRAME_BYTES) {
          out.push(seal(pending.subarray(0, FRAME_BYTES), false));
          pending = pending.subarray(FRAME_BYTES);
        }
        done(null, Buffer.concat(withHeader(out)));
      } catch (err) {
        done(err as Error);
      }
    },
    flush(done: TransformCallback) {
      try {
        done(null, Buffer.concat(withHeader([seal(pending, true)])));
      } catch (err) {
        done(err as Error);
      }
    },
  });
}

/// `lenient` lets a file with no magic pass straight through (used for restore and
/// verify, which accept both plain and encrypted backups). Without it, anything
/// that is not an encrypted backup is an error.
export function createBackupDecryptor(
  masterKey: Buffer | null,
  opts: { lenient?: boolean } = {},
): Transform {
  let buf: Buffer = Buffer.alloc(0);
  let mode: "sniff" | "plain" | "frames" = "sniff";
  let header: Buffer = Buffer.alloc(0);
  let key: Buffer = Buffer.alloc(0);
  let prefix: Buffer = Buffer.alloc(0);
  let counter = 0;

  const open = (frameLength: number, frame: Buffer, last: boolean): Buffer => {
    const decipher = createDecipheriv(
      "aes-256-gcm",
      key,
      frameNonce(prefix, counter),
      { authTagLength: TAG_BYTES },
    );
    decipher.setAAD(frameAad(header, counter, last));
    decipher.setAuthTag(frame.subarray(frameLength));
    try {
      return Buffer.concat([
        decipher.update(frame.subarray(0, frameLength)),
        decipher.final(),
      ]);
    } catch {
      throw new BackupCryptoError(
        "Could not decrypt the backup: wrong BACKUP_ENCRYPTION_KEY, or the file is damaged or has been tampered with.",
      );
    }
  };

  // A frame is only opened once bytes after it prove it is not the last one; the
  // final frame is held until the stream ends (see flush), so a chunk boundary that
  // happens to fall exactly after a frame is never mistaken for the end of the file.
  const drain = (): Buffer[] => {
    const out: Buffer[] = [];
    while (buf.length >= 4) {
      const length = buf.readUInt32BE(0);
      if (length > FRAME_BYTES)
        throw new BackupCryptoError(
          "The encrypted backup is corrupt (oversized frame).",
        );
      const total = 4 + length + TAG_BYTES;
      if (buf.length <= total) break;
      out.push(open(length, buf.subarray(4, total), false));
      counter += 1;
      buf = buf.subarray(total);
    }
    return out;
  };

  return new Transform({
    transform(chunk: Buffer, _enc: string, done: TransformCallback) {
      try {
        if (mode === "plain") return done(null, chunk);
        buf = Buffer.concat([buf, chunk]);
        if (mode === "sniff") {
          if (buf.length < BACKUP_MAGIC.length) return done();
          if (!isEncryptedBackupHead(buf)) {
            if (!opts.lenient)
              throw new BackupCryptoError(
                "That file is not an encrypted backup.",
              );
            mode = "plain";
            const all = buf;
            buf = Buffer.alloc(0);
            return done(null, all);
          }
          if (!masterKey)
            throw new BackupCryptoError(
              "This backup is encrypted but BACKUP_ENCRYPTION_KEY is not set on this server.",
            );
          if (buf.length < HEADER_BYTES) return done();
          header = buf.subarray(0, HEADER_BYTES);
          key = fileKey(
            masterKey,
            header.subarray(
              BACKUP_MAGIC.length,
              BACKUP_MAGIC.length + SALT_BYTES,
            ),
          );
          prefix = header.subarray(HEADER_BYTES - PREFIX_BYTES, HEADER_BYTES);
          buf = buf.subarray(HEADER_BYTES);
          mode = "frames";
        }
        done(null, Buffer.concat(drain()));
      } catch (err) {
        done(err as Error);
      }
    },
    flush(done: TransformCallback) {
      if (mode === "sniff") {
        if (opts.lenient) {
          // Shorter than the magic: cannot be an encrypted backup.
          if (buf.length) this.push(buf);
          return done();
        }
        return done(
          new BackupCryptoError("That file is not an encrypted backup."),
        );
      }
      if (mode === "frames") {
        try {
          const length = buf.length >= 4 ? buf.readUInt32BE(0) : -1;
          if (
            length < 0 ||
            length > FRAME_BYTES ||
            buf.length !== 4 + length + TAG_BYTES
          ) {
            throw new BackupCryptoError(
              "The encrypted backup is incomplete (cut short) or has extra data at the end.",
            );
          }
          this.push(open(length, buf.subarray(4), true));
        } catch (err) {
          return done(err as Error);
        }
      }
      done();
    },
  });
}
