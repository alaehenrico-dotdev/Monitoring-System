import { describe, expect, it } from "vitest";
import { open, seal } from "./secretBox";

const SECRET = "a-long-server-secret-used-only-in-this-test-0123456789";

describe("secretBox", () => {
  it("round-trips a value", () => {
    expect(open(seal("1//refresh-token-value", SECRET), SECRET)).toBe("1//refresh-token-value");
  });

  it("does not store the value in the clear", () => {
    expect(seal("1//refresh-token-value", SECRET)).not.toContain("refresh-token-value");
  });

  it("gives a different ciphertext each time, so equal tokens do not look equal", () => {
    expect(seal("same", SECRET)).not.toBe(seal("same", SECRET));
  });

  it("refuses to open with a different secret", () => {
    expect(() => open(seal("x", SECRET), SECRET + "-changed")).toThrow();
  });

  it("refuses a value that was tampered with", () => {
    const [v, iv, tag, data] = seal("x", SECRET).split(".");
    const flipped = Buffer.from(data, "base64url");
    flipped[0] ^= 1;
    expect(() => open([v, iv, tag, flipped.toString("base64url")].join("."), SECRET)).toThrow();
  });

  it("refuses something that is not one of its values", () => {
    expect(() => open("plain-text", SECRET)).toThrow(/Unrecognised/);
  });
});
