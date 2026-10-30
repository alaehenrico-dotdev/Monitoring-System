import bcrypt from "bcryptjs";
import { describe, expect, it } from "vitest";
import { hashPassword, hashPasswordSync, needsRehash, passwordProblem, verifyPassword } from "./password";

describe("passwordProblem", () => {
  it("accepts a long passphrase with no symbols or capitals", () => {
    expect(passwordProblem("correct horse battery staple")).toBeNull();
    expect(passwordProblem("tricycle-mango-lantern", "ana")).toBeNull();
  });

  it("refuses anything under 10 characters", () => {
    expect(passwordProblem("Sh0rt!pw")).toMatch(/at least 10/);
  });

  it("refuses more than 72 bytes, counting multi-byte characters", () => {
    expect(passwordProblem("correct horse battery staple, and then some more words to fill 72 b")).toBeNull();
    expect(passwordProblem("x".repeat(73))).toMatch(/at most 72/);
    expect(passwordProblem("é".repeat(40))).toMatch(/at most 72/);
  });

  it("refuses common passwords however they are dressed up", () => {
    for (const bad of ["password123", "Password-123!", "QWERTYUIOP", "1234567890", "ILoveYou123", "Admin@12345", "P@ssw0rd"]) {
      expect(passwordProblem(bad), bad).toMatch(/too common|at least/);
    }
  });

  it("refuses passwords with almost no variety", () => {
    expect(passwordProblem("aaaaaaaaaaaa")).toMatch(/repetitive/);
    expect(passwordProblem("abababababab")).toMatch(/repetitive/);
  });

  it("refuses a password containing the username", () => {
    expect(passwordProblem("ana-is-great-2026", "ana")).toMatch(/username/);
    expect(passwordProblem("online.encoder#1", "Online.Encoder")).toMatch(/username/);
    // Too-short usernames are not worth matching on.
    expect(passwordProblem("a-different-phrase", "ab")).toBeNull();
  });
});

describe("hashing", () => {
  it("hashes with scrypt at today's settings and verifies, with a fresh salt each time", async () => {
    const a = await hashPassword("some long passphrase");
    const b = await hashPassword("some long passphrase");
    expect(a).toMatch(/^scrypt\$\d+\$8\$\d+\$[A-Za-z0-9+/=]+\$[A-Za-z0-9+/=]+$/);
    expect(a).not.toBe(b);
    expect(await verifyPassword("some long passphrase", a)).toBe(true);
    expect(await verifyPassword("some long passphrasE", a)).toBe(false);
    expect(await verifyPassword("", a)).toBe(false);
  });

  it("treats visually identical Unicode spellings as the same password", async () => {
    const hash = await hashPassword("café au lait 2026");
    expect(await verifyPassword("café au lait 2026", hash)).toBe(true);
  });

  it("still accepts hashes made before scrypt (bcrypt), and flags them for upgrade", async () => {
    const legacy = bcrypt.hashSync("old password here", 10);
    expect(await verifyPassword("old password here", legacy)).toBe(true);
    expect(await verifyPassword("not it at all", legacy)).toBe(false);
    expect(needsRehash(legacy)).toBe(true);
  });

  it("leaves a current hash alone and flags weaker scrypt settings", () => {
    const current = hashPasswordSync("x".repeat(12));
    expect(needsRehash(current)).toBe(false);
    expect(needsRehash(current.replace(/^scrypt\$\d+/, "scrypt$256"))).toBe(true); // lower N
    expect(needsRehash(current.replace(/^(scrypt\$\d+)\$\d+/, "$1$4"))).toBe(true); // lower r
    expect(needsRehash("garbage")).toBe(true);
  });

  it("treats a malformed or hostile stored hash as a non-match, never an exception or a huge allocation", async () => {
    for (const bad of ["", "garbage", "scrypt$", "scrypt$32768$8$3$$", "scrypt$3$8$3$c2FsdA==$a2V5", "scrypt$99999999$8$3$c2FsdA==$a2V5", "scrypt$32768$8$3$c2FsdA==$"]) {
      expect(await verifyPassword("anything", bad), bad).toBe(false);
    }
  });
});
