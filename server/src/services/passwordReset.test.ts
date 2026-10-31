import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../lib/prisma", () => ({ prisma: {} }));
vi.mock("../lib/cache", () => ({ invalidate: vi.fn() }));
vi.mock("../repositories/userRepository", () => ({
  userRepository: {
    findByUsername: vi.fn(),
    findById: vi.fn(),
    setResetCode: vi.fn(),
    recordResetFailure: vi.fn(),
    consumeResetCode: vi.fn(),
    setPasswordHash: vi.fn(),
  },
}));
const verifyMfaCode = vi.hoisted(() => vi.fn());
vi.mock("./mfa.service", () => ({ verifyMfaCode }));
vi.mock("./changeLog.service", () => ({ recordChange: vi.fn(), logSystemEvent: vi.fn() }));
const assertAdminPassword = vi.hoisted(() => vi.fn());
vi.mock("./adminPassword.service", () => ({ assertAdminPassword }));

import { invalidate } from "../lib/cache";
import { userRepository } from "../repositories/userRepository";
import { generateResetCode, hashResetCode, RESET_CODE_TTL_MS, RESET_MAX_ATTEMPTS } from "../utils/resetCode";
import { logSystemEvent } from "./changeLog.service";
import { issueResetCode, resetPasswordWithCode } from "./users.service";

const GOOD_PASSWORD = "tricycle-mango-lantern";
const CODE = "ABCDE-FGHJK";

function account(overrides: Record<string, unknown> = {}) {
  return {
    id: 7,
    username: "ana",
    isActive: true,
    resetCodeHash: hashResetCode(CODE),
    resetCodeExpiresAt: new Date(Date.now() + 10 * 60 * 1000),
    resetCodeAttempts: 0,
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  assertAdminPassword.mockResolvedValue(undefined);
  vi.mocked(userRepository.consumeResetCode).mockResolvedValue(true);
});

describe("reset codes", () => {
  it("look like XXXXX-XXXXX from an alphabet without look-alikes, and are all different", () => {
    const codes = new Set(Array.from({ length: 200 }, generateResetCode));
    expect(codes.size).toBe(200);
    for (const c of codes) expect(c).toMatch(/^[A-HJ-NP-Z2-9]{5}-[A-HJ-NP-Z2-9]{5}$/);
  });

  it("hash the same however they are typed", () => {
    expect(hashResetCode("abcde fghjk")).toBe(hashResetCode(CODE));
    expect(hashResetCode("ABCDEFGHJK")).toBe(hashResetCode(CODE));
    expect(hashResetCode("ABCDE-FGHJL")).not.toBe(hashResetCode(CODE));
  });
});

describe("issueResetCode (administrator)", () => {
  it("needs the admin's own password, and issues nothing without it", async () => {
    assertAdminPassword.mockRejectedValue(Object.assign(new Error("Incorrect password"), { status: 403 }));
    await expect(issueResetCode(7, 1, "wrong")).rejects.toMatchObject({ status: 403 });
    expect(userRepository.setResetCode).not.toHaveBeenCalled();
  });

  it("hands back the code once, stores only its hash, and expires in 30 minutes", async () => {
    vi.mocked(userRepository.findById).mockResolvedValue(account() as never);
    const before = Date.now();

    const { code, expiresAt } = await issueResetCode(7, 1, "admin-pw");

    expect(code).toMatch(/^[A-HJ-NP-Z2-9]{5}-[A-HJ-NP-Z2-9]{5}$/);
    const [id, hash, stored] = vi.mocked(userRepository.setResetCode).mock.calls[0];
    expect(id).toBe(7);
    expect(hash).toBe(hashResetCode(code));
    expect(hash).not.toContain(code.replace("-", ""));
    expect(stored.getTime() - before).toBeGreaterThanOrEqual(RESET_CODE_TTL_MS - 50);
    expect(stored.getTime() - before).toBeLessThanOrEqual(RESET_CODE_TTL_MS + 2000);
    expect(expiresAt).toBe(stored);
    // The audit trail says it happened, never what the code was.
    expect(JSON.stringify(vi.mocked(logSystemEvent).mock.calls)).not.toContain(code);
    expect(logSystemEvent).toHaveBeenCalledWith("password_reset_code_issued", expect.objectContaining({ username: "ana" }), 1, "UPDATE");
  });

  it("404s for an unknown account and refuses a deactivated one", async () => {
    vi.mocked(userRepository.findById).mockResolvedValue(null);
    await expect(issueResetCode(99, 1, "pw")).rejects.toMatchObject({ status: 404 });
    vi.mocked(userRepository.findById).mockResolvedValue(account({ isActive: false }) as never);
    await expect(issueResetCode(7, 1, "pw")).rejects.toMatchObject({ status: 409 });
    expect(userRepository.setResetCode).not.toHaveBeenCalled();
  });
});

describe("resetPasswordWithCode (the person, signed out)", () => {
  it("sets the new password with a valid code, however the code is typed", async () => {
    vi.mocked(userRepository.findByUsername).mockResolvedValue(account() as never);

    await resetPasswordWithCode("ana", "abcde fghjk", GOOD_PASSWORD, "10.0.0.5");

    const [id, hash, now, passwordHash] = vi.mocked(userRepository.consumeResetCode).mock.calls[0];
    expect(id).toBe(7);
    expect(hash).toBe(hashResetCode(CODE));
    expect(now).toBeInstanceOf(Date);
    expect(passwordHash).toMatch(/^scrypt\$/);
    expect(invalidate).toHaveBeenCalledWith("user-status:7");
    expect(logSystemEvent).toHaveBeenCalledWith("password_reset_by_code", { username: "ana", ip: "10.0.0.5" }, 7, "UPDATE");
    expect(JSON.stringify(vi.mocked(logSystemEvent).mock.calls)).not.toContain(GOOD_PASSWORD);
  });

  it("gives every failure the same answer, so it cannot be used to find usernames or outstanding codes", async () => {
    const cases: Array<[string, unknown, string]> = [
      ["no such account", null, CODE],
      ["account without a code", account({ resetCodeHash: null, resetCodeExpiresAt: null }), CODE],
      ["wrong code", account(), "ZZZZZ-ZZZZZ"],
      ["expired code", account({ resetCodeExpiresAt: new Date(Date.now() - 1000) }), CODE],
      ["deactivated account", account({ isActive: false }), CODE],
      ["code already cancelled by guesses", account({ resetCodeAttempts: RESET_MAX_ATTEMPTS }), CODE],
    ];
    const messages = new Set<string>();
    for (const [label, row, code] of cases) {
      vi.mocked(userRepository.findByUsername).mockResolvedValue(row as never);
      const err = await resetPasswordWithCode("ana", code, GOOD_PASSWORD).catch((e) => e);
      expect(err.status, label).toBe(400);
      messages.add(err.message);
    }
    expect(messages.size).toBe(1);
    expect(userRepository.consumeResetCode).not.toHaveBeenCalled();
  });

  it("counts a wrong guess against a live code, but not against an account that has none", async () => {
    vi.mocked(userRepository.findByUsername).mockResolvedValue(account() as never);
    await resetPasswordWithCode("ana", "ZZZZZ-ZZZZZ", GOOD_PASSWORD).catch(() => {});
    expect(userRepository.recordResetFailure).toHaveBeenCalledWith(7, RESET_MAX_ATTEMPTS);

    vi.mocked(userRepository.recordResetFailure).mockClear();
    vi.mocked(userRepository.findByUsername).mockResolvedValue(account({ resetCodeHash: null, resetCodeExpiresAt: null }) as never);
    await resetPasswordWithCode("ana", "ZZZZZ-ZZZZZ", GOOD_PASSWORD).catch(() => {});
    vi.mocked(userRepository.findByUsername).mockResolvedValue(null);
    await resetPasswordWithCode("nobody", "ZZZZZ-ZZZZZ", GOOD_PASSWORD).catch(() => {});
    expect(userRepository.recordResetFailure).not.toHaveBeenCalled();
  });

  it("logs a failure with the username and address, never the code or the new password", async () => {
    vi.mocked(userRepository.findByUsername).mockResolvedValue(account() as never);
    await resetPasswordWithCode("ana", "ZZZZZ-ZZZZZ", GOOD_PASSWORD, "10.0.0.5").catch(() => {});
    expect(logSystemEvent).toHaveBeenCalledWith("password_reset_failed", { username: "ana", ip: "10.0.0.5" });
    const logged = JSON.stringify(vi.mocked(logSystemEvent).mock.calls);
    expect(logged).not.toContain("ZZZZZ");
    expect(logged).not.toContain(GOOD_PASSWORD);
  });

  it("refuses a weak new password with the reason, WITHOUT using up the code", async () => {
    vi.mocked(userRepository.findByUsername).mockResolvedValue(account() as never);
    await expect(resetPasswordWithCode("ana", CODE, "password123")).rejects.toMatchObject({ status: 400, message: expect.stringMatching(/common/) });
    await expect(resetPasswordWithCode("ana", CODE, "ana-is-great-2026")).rejects.toMatchObject({ status: 400, message: expect.stringMatching(/username/) });
    expect(userRepository.consumeResetCode).not.toHaveBeenCalled();
    expect(userRepository.recordResetFailure).not.toHaveBeenCalled();
  });

  it("lets only one of two racing requests with the same code win", async () => {
    vi.mocked(userRepository.findByUsername).mockResolvedValue(account() as never);
    vi.mocked(userRepository.consumeResetCode).mockResolvedValueOnce(true).mockResolvedValueOnce(false);
    const results = await Promise.allSettled([
      resetPasswordWithCode("ana", CODE, GOOD_PASSWORD),
      resetPasswordWithCode("ana", CODE, GOOD_PASSWORD),
    ]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(results.filter((r) => r.status === "rejected")).toHaveLength(1);
  });
});

describe("resetPasswordWithCode with an authenticator (an Encoder, signed out)", () => {
  const encoder = (over: Record<string, unknown> = {}) =>
    account({ role: "ENCODER", resetCodeHash: null, resetCodeExpiresAt: null, totpEnabledAt: new Date(), totpSecret: "sealed", ...over });

  it("sets the new password and signs out other sessions when the authenticator code is right", async () => {
    vi.mocked(userRepository.findByUsername).mockResolvedValue(encoder() as never);
    verifyMfaCode.mockResolvedValue(true);
    await resetPasswordWithCode("ana", "123456", GOOD_PASSWORD, "10.0.0.5");
    expect(userRepository.setPasswordHash).toHaveBeenCalledWith(7, expect.any(String), false);
    expect(invalidate).toHaveBeenCalledWith("user-status:7");
    expect(logSystemEvent).toHaveBeenCalledWith("password_reset_by_mfa", expect.objectContaining({ username: "ana" }), 7, "UPDATE");
  });

  it("answers a wrong or locked-out authenticator code like any other bad code", async () => {
    vi.mocked(userRepository.findByUsername).mockResolvedValue(encoder() as never);
    verifyMfaCode.mockResolvedValue(false);
    await expect(resetPasswordWithCode("ana", "000000", GOOD_PASSWORD)).rejects.toMatchObject({ status: 400, message: expect.stringMatching(/invalid or has expired/) });
    verifyMfaCode.mockRejectedValue(new Error("Too many incorrect codes"));
    await expect(resetPasswordWithCode("ana", "000000", GOOD_PASSWORD)).rejects.toMatchObject({ status: 400, message: expect.stringMatching(/invalid or has expired/) });
    expect(userRepository.setPasswordHash).not.toHaveBeenCalled();
  });

  it("never lets an Admin reset with an authenticator code alone", async () => {
    vi.mocked(userRepository.findByUsername).mockResolvedValue(encoder({ role: "SUPERVISOR_ADMIN" }) as never);
    verifyMfaCode.mockResolvedValue(true);
    await expect(resetPasswordWithCode("ana", "123456", GOOD_PASSWORD)).rejects.toMatchObject({ status: 400 });
    expect(verifyMfaCode).not.toHaveBeenCalled();
    expect(userRepository.setPasswordHash).not.toHaveBeenCalled();
  });

  it("does not offer it to an Encoder without two-step verification, or a deactivated one", async () => {
    verifyMfaCode.mockResolvedValue(true);
    for (const over of [{ totpEnabledAt: null }, { isActive: false }]) {
      vi.mocked(userRepository.findByUsername).mockResolvedValue(encoder(over) as never);
      await expect(resetPasswordWithCode("ana", "123456", GOOD_PASSWORD)).rejects.toMatchObject({ status: 400 });
    }
    expect(verifyMfaCode).not.toHaveBeenCalled();
  });

  it("refuses a weak password before any code is checked or spent", async () => {
    vi.mocked(userRepository.findByUsername).mockResolvedValue(encoder() as never);
    await expect(resetPasswordWithCode("ana", "123456", "password123")).rejects.toMatchObject({ status: 400, message: expect.stringMatching(/common/) });
    expect(verifyMfaCode).not.toHaveBeenCalled();
  });
});
