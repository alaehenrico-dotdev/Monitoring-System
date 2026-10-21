import { createCipheriv, createDecipheriv, hkdfSync, randomBytes } from "crypto";

/// Encrypts a short secret (an OAuth refresh token) so it is not readable in a
/// database dump or backup. AES-256-GCM: tampering with the stored value makes
/// decryption throw rather than return garbage. The key is derived from a
/// server secret (HKDF), never stored beside the data it protects.
///
/// Format: `v1.<iv>.<tag>.<ciphertext>`, each part base64url.
const VERSION = "v1";

function keyFrom(secret: string): Buffer {
  return Buffer.from(hkdfSync("sha256", secret, "", "ala-eh:secret-box", 32));
}

export function seal(plain: string, secret: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", keyFrom(secret), iv);
  const data = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  return [VERSION, iv, cipher.getAuthTag(), data].map((p) => (typeof p === "string" ? p : p.toString("base64url"))).join(".");
}

export function open(sealed: string, secret: string): string {
  const [version, iv, tag, data] = sealed.split(".");
  if (version !== VERSION || !iv || !tag || data === undefined) throw new Error("Unrecognised encrypted value");
  const decipher = createDecipheriv("aes-256-gcm", keyFrom(secret), Buffer.from(iv, "base64url"));
  decipher.setAuthTag(Buffer.from(tag, "base64url"));
  return Buffer.concat([decipher.update(Buffer.from(data, "base64url")), decipher.final()]).toString("utf8");
}
