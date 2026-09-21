import { describe, expect, it } from "vitest";
import { HttpError } from "./HttpError";
import { decryptReceiptId, encryptReceiptId } from "./receiptQrToken";

describe("encryptReceiptId / decryptReceiptId", () => {
  it("round-trips an id", () => {
    expect(decryptReceiptId(encryptReceiptId(42))).toBe(42);
    expect(decryptReceiptId(encryptReceiptId(1))).toBe(1);
  });

  it("produces a different token each time (random IV) for the same id", () => {
    // Not deterministic - a fixed mapping from id to token would let anyone
    // who sees two receipts start reasoning about the id from the token's
    // shape/length alone.
    expect(encryptReceiptId(42)).not.toBe(encryptReceiptId(42));
  });

  it("rejects a corrupted or tampered token instead of returning a wrong id", () => {
    const token = encryptReceiptId(42);
    const tampered = token.slice(0, -2) + (token.slice(-2) === "AA" ? "BB" : "AA");
    expect(() => decryptReceiptId(tampered)).toThrow(HttpError);
  });

  it("rejects garbage input", () => {
    expect(() => decryptReceiptId("not-a-real-token")).toThrow(HttpError);
    expect(() => decryptReceiptId("")).toThrow(HttpError);
  });
});
