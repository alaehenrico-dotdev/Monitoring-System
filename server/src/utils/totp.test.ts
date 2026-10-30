import { describe, expect, it } from "vitest";
import {
  base32Decode,
  base32Encode,
  currentStep,
  generateRecoveryCodes,
  generateTotpSecret,
  hashRecoveryCode,
  openSecret,
  otpauthUrl,
  sealSecret,
  totpCodeAt,
  verifyTotp,
} from "./totp";

// RFC 6238 Appendix B test vectors (SHA-1, secret "12345678901234567890", 8 digits there;
// the last 6 digits of each are what a 6-digit code is).
const RFC_SECRET = base32Encode(Buffer.from("12345678901234567890", "ascii"));

describe("totp", () => {
  it("matches the RFC 6238 test vectors", () => {
    const vectors: Array<[number, string]> = [
      [59, "287082"],
      [1111111109, "081804"],
      [1111111111, "050471"],
      [1234567890, "005924"],
      [2000000000, "279037"],
    ];
    for (const [seconds, code] of vectors) expect(totpCodeAt(RFC_SECRET, Math.floor(seconds / 30))).toBe(code);
  });

  it("round-trips base32", () => {
    const bytes = Buffer.from([0, 1, 2, 250, 251, 252, 253, 254, 255, 9]);
    expect(base32Decode(base32Encode(bytes)).equals(bytes)).toBe(true);
    expect(generateTotpSecret()).toMatch(/^[A-Z2-7]{32}$/);
  });

  it("accepts the current code and one step of clock drift, not more", () => {
    const secret = generateTotpSecret();
    const now = Date.now();
    const step = currentStep(now);
    expect(verifyTotp(secret, totpCodeAt(secret, step), null, now)).toBe(step);
    expect(verifyTotp(secret, totpCodeAt(secret, step - 1), null, now)).toBe(step - 1);
    expect(verifyTotp(secret, totpCodeAt(secret, step + 1), null, now)).toBe(step + 1);
    expect(verifyTotp(secret, totpCodeAt(secret, step - 3), null, now)).toBeNull();
  });

  it("refuses to accept the same step twice (replay)", () => {
    const secret = generateTotpSecret();
    const now = Date.now();
    const step = currentStep(now);
    const code = totpCodeAt(secret, step);
    expect(verifyTotp(secret, code, step, now)).toBeNull();
    expect(verifyTotp(secret, code, step - 1, now)).toBe(step);
  });

  it("rejects malformed input without throwing", () => {
    const secret = generateTotpSecret();
    for (const bad of ["", "abc123", "12345", "1234567", "12 34 5"]) expect(verifyTotp(secret, bad, null)).toBeNull();
  });

  it("builds the link an authenticator app scans", () => {
    const url = otpauthUrl("ABCDEFGH", "ana");
    expect(url).toContain("otpauth://totp/Ala%20Eh%20Stocks%3Aana?secret=ABCDEFGH");
    expect(url).toContain("digits=6");
  });

  it("stores the secret sealed, and a flipped byte fails to open", () => {
    const secret = generateTotpSecret();
    const sealed = sealSecret(secret);
    expect(sealed).not.toContain(secret);
    expect(openSecret(sealed)).toBe(secret);
    expect(sealSecret(secret)).not.toBe(sealed);
    const raw = Buffer.from(sealed, "base64");
    raw[raw.length - 1] ^= 1;
    expect(() => openSecret(raw.toString("base64"))).toThrow();
  });

  it("makes distinct recovery codes that hash the same however they are typed", () => {
    const codes = generateRecoveryCodes();
    expect(codes).toHaveLength(8);
    expect(new Set(codes).size).toBe(8);
    for (const c of codes) expect(c).toMatch(/^[A-Z2-9]{5}-[A-Z2-9]{5}$/);
    expect(hashRecoveryCode(codes[0])).toBe(hashRecoveryCode(codes[0].toLowerCase().replace("-", " ")));
  });
});
