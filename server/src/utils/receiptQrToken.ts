import { createCipheriv, createDecipheriv, createHash, randomBytes } from "crypto";
import { env } from "../config/env";
import { HttpError } from "./HttpError";

// SHA-256 of the configured secret - lets RECEIPT_QR_SECRET be any length
// string while still handing AES-256-GCM the exact 32-byte key it requires.
const KEY = createHash("sha256").update(env.receiptQrSecret).digest();
const IV_LENGTH = 12; // AES-GCM's standard nonce size
const AUTH_TAG_LENGTH = 16;

/**
 * Section: Security - id obfuscation, scoped deliberately narrow. Every id
 * in this app (products, stock entries, other receipt fields) stays a
 * plain integer: access control here is role-based (SUPERVISOR_ADMIN vs.
 * encoder), not per-owner, so knowing another record's id doesn't expose
 * anything a valid session couldn't already see through the normal list
 * endpoints - encrypting those would add real engineering cost (every
 * response, every save payload) for no real reduction in exposure.
 *
 * The one exception: a receipt's id gets printed into a QR code (see
 * client/src/utils/receiptPdf.ts and components/ReceiptCard.tsx) that
 * physically leaves the authenticated app - a delivery driver or customer
 * can scan it. That's a real boundary crossing, so it's the one id that
 * gets a genuine keyed cipher (AES-256-GCM, not just a reversible encoding
 * anyone could reproduce by spotting the algorithm) rather than a plain
 * integer or a same-algorithm-for-everyone hashid.
 *
 * Nothing currently decodes this token server-side (there's no
 * scan-to-look-up feature yet) - decryptReceiptId exists so that feature
 * can be added later without a second encoding scheme to reconcile.
 */
export function encryptReceiptId(id: number): string {
  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv("aes-256-gcm", KEY, iv);
  const ciphertext = Buffer.concat([cipher.update(String(id), "utf8"), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return Buffer.concat([iv, authTag, ciphertext]).toString("base64url");
}

export function decryptReceiptId(token: string): number {
  try {
    const raw = Buffer.from(token, "base64url");
    const iv = raw.subarray(0, IV_LENGTH);
    const authTag = raw.subarray(IV_LENGTH, IV_LENGTH + AUTH_TAG_LENGTH);
    const ciphertext = raw.subarray(IV_LENGTH + AUTH_TAG_LENGTH);

    const decipher = createDecipheriv("aes-256-gcm", KEY, iv);
    decipher.setAuthTag(authTag);
    const plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString("utf8");

    const id = Number(plaintext);
    if (!Number.isInteger(id) || id <= 0) throw new Error("not a valid id");
    return id;
  } catch {
    // Wrong key, corrupted/truncated token, or a tampered auth tag all land
    // here - GCM's tag check means this also catches any attempt to edit
    // the token, not just malformed input.
    throw HttpError.badRequest("Invalid or corrupted receipt QR token");
  }
}
