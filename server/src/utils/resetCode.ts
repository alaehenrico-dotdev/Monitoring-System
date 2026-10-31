import { createHash, randomInt, timingSafeEqual } from "node:crypto";

/// Forgot password: an administrator issues a one-time code and hands it to the person, who
/// enters it with their username and a new password. The code is 10 characters from an
/// alphabet without look-alikes (50 bits), is stored only as a SHA-256 hash (it is random, so a
/// fast hash is enough: there is nothing to guess from), works once, expires after 30 minutes,
/// and is cancelled after 5 wrong guesses.
export const RESET_CODE_TTL_MS = 30 * 60 * 1000;
export const RESET_MAX_ATTEMPTS = 5;

const ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

/// "XXXXX-XXXXX"
export function generateResetCode(): string {
  const pick = () => Array.from({ length: 5 }, () => ALPHABET[randomInt(ALPHABET.length)]).join("");
  return `${pick()}-${pick()}`;
}

/// Case, spaces and the dash do not matter when the code is typed.
export function hashResetCode(code: string): string {
  return createHash("sha256").update(code.replace(/[\s-]/g, "").toUpperCase()).digest("hex");
}

/// Constant-time comparison of two hashes (both 64 hex characters, or a dummy of the same shape).
export function sameResetHash(a: string, b: string): boolean {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

/// What a missing account or an account with no code is compared against, so those paths do
/// the same work as a real one.
export const DUMMY_RESET_HASH = hashResetCode("no-account-has-this-code");
