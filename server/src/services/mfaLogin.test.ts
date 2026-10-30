import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../repositories/userRepository", () => ({
  userRepository: {
    findByUsername: vi.fn(),
    findById: vi.fn(),
    upgradePasswordHash: vi.fn(),
    consumeTotpStep: vi.fn(),
    setRecoveryCodes: vi.fn(),
  },
}));
vi.mock("./changeLog.service", () => ({ logSystemEvent: vi.fn() }));

import bcrypt from "bcryptjs";
import { hashPasswordSync } from "../utils/password";
import { userRepository } from "../repositories/userRepository";
import { completeMfaLogin, login } from "./auth.service";
import { verifyToken } from "../utils/jwt";
import { currentStep, generateTotpSecret, hashRecoveryCode, sealSecret, totpCodeAt } from "../utils/totp";

const PASSWORD = "correct-horse-battery";
const SECRET = generateTotpSecret();

function mfaUser(overrides: Record<string, unknown> = {}) {
  return {
    id: 7,
    username: "ana",
    name: "Ana Cruz",
    role: "SUPERVISOR_ADMIN",
    passwordHash: hashPasswordSync(PASSWORD),
    isActive: true,
    tokenVersion: 3,
    totpSecret: sealSecret(SECRET),
    totpEnabledAt: new Date(),
    totpLastStep: null,
    recoveryCodes: null,
    ...overrides,
  };
}

async function challenge(overrides: Record<string, unknown> = {}) {
  const user = mfaUser(overrides);
  vi.mocked(userRepository.findByUsername).mockResolvedValue(user as never);
  vi.mocked(userRepository.findById).mockResolvedValue(user as never);
  const result = await login("ana", PASSWORD);
  if (!("mfaRequired" in result)) throw new Error("expected an MFA challenge");
  return result.mfaToken;
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(userRepository.consumeTotpStep).mockResolvedValue(true);
});

describe("two-step login", () => {
  it("answers a correct password with a challenge, not a session", async () => {
    vi.mocked(userRepository.findByUsername).mockResolvedValue(mfaUser() as never);
    const result = await login("ana", PASSWORD);
    expect(result).toHaveProperty("mfaRequired", true);
    expect(result).not.toHaveProperty("token");
  });

  it("the challenge token is useless as a session token", async () => {
    const mfaToken = await challenge();
    expect(() => verifyToken(mfaToken)).toThrow();
  });

  it("a session token is useless as a challenge", async () => {
    const mfaToken = await challenge();
    const session = await completeMfaLogin(mfaToken, totpCodeAt(SECRET, currentStep()));
    await expect(completeMfaLogin(session.token, "123456")).rejects.toMatchObject({ status: 401 });
  });

  it("completes with a valid authenticator code and issues a real session", async () => {
    const mfaToken = await challenge();
    const session = await completeMfaLogin(mfaToken, totpCodeAt(SECRET, currentStep()));
    expect(verifyToken(session.token)).toMatchObject({ id: 7, role: "SUPERVISOR_ADMIN", tv: 3 });
    expect(userRepository.consumeTotpStep).toHaveBeenCalledWith(7, currentStep());
  });

  it("refuses a wrong code", async () => {
    const mfaToken = await challenge({ id: 21 });
    await expect(completeMfaLogin(mfaToken, "000000")).rejects.toMatchObject({ status: 401 });
  });

  it("refuses a code whose step was already used (replay)", async () => {
    const mfaToken = await challenge({ id: 22 });
    vi.mocked(userRepository.consumeTotpStep).mockResolvedValue(false);
    await expect(completeMfaLogin(mfaToken, totpCodeAt(SECRET, currentStep()))).rejects.toMatchObject({ status: 401 });
  });

  it("refuses if the password was reset after the challenge was issued", async () => {
    const mfaToken = await challenge({ id: 23 });
    vi.mocked(userRepository.findById).mockResolvedValue(mfaUser({ id: 23, tokenVersion: 4 }) as never);
    await expect(completeMfaLogin(mfaToken, totpCodeAt(SECRET, currentStep()))).rejects.toMatchObject({ status: 401 });
  });

  it("accepts a recovery code once and removes it", async () => {
    const code = "ABCDE-FGHJK";
    const other = hashRecoveryCode("ZZZZZ-YYYYY");
    const mfaToken = await challenge({ id: 24, recoveryCodes: [hashRecoveryCode(code), other] });
    const session = await completeMfaLogin(mfaToken, code.toLowerCase());
    expect(session.user.id).toBe(24);
    expect(userRepository.setRecoveryCodes).toHaveBeenCalledWith(24, [other]);
  });

  it("lets a recovery code open the door only once, even when two requests race with it", async () => {
    const code = "QRSTU-VWXYZ";
    const state = mfaUser({ id: 31, recoveryCodes: [hashRecoveryCode(code)] }) as Record<string, unknown>;
    vi.mocked(userRepository.findByUsername).mockResolvedValue(state as never);
    // Reads see whatever the last write left, like the real table (with a little latency).
    vi.mocked(userRepository.findById).mockImplementation((async () => {
      await new Promise((r) => setTimeout(r, 5));
      return { ...state };
    }) as never);
    vi.mocked(userRepository.setRecoveryCodes).mockImplementation((async (_id: number, hashes: string[]) => {
      await new Promise((r) => setTimeout(r, 5));
      state.recoveryCodes = hashes;
    }) as never);
    const first = (await login("ana", PASSWORD)) as { mfaToken: string };
    const second = (await login("ana", PASSWORD)) as { mfaToken: string };

    const results = await Promise.allSettled([completeMfaLogin(first.mfaToken, code), completeMfaLogin(second.mfaToken, code)]);

    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(results.filter((r) => r.status === "rejected")).toHaveLength(1);
    expect(state.recoveryCodes).toEqual([]);
  });

  it("locks the account's codes after repeated failures", async () => {
    const mfaToken = await challenge({ id: 25 });
    for (let i = 0; i < 5; i++) await completeMfaLogin(mfaToken, "000000").catch(() => {});
    await expect(completeMfaLogin(mfaToken, totpCodeAt(SECRET, currentStep()))).rejects.toMatchObject({ status: 429 });
  });
});

describe("hash upgrade at login", () => {
  it("replaces an old bcrypt hash with a scrypt one after a successful sign-in, and never fails the login if that breaks", async () => {
    const plain = { ...mfaUser(), totpEnabledAt: null, passwordHash: bcrypt.hashSync(PASSWORD, 10) };
    vi.mocked(userRepository.findByUsername).mockResolvedValue(plain as never);
    await login("ana", PASSWORD);
    expect(userRepository.upgradePasswordHash).toHaveBeenCalledTimes(1);
    const [, newHash] = vi.mocked(userRepository.upgradePasswordHash).mock.calls[0];
    expect(newHash).toMatch(/^scrypt\$\d+\$8\$\d+\$/);

    vi.mocked(userRepository.upgradePasswordHash).mockRejectedValueOnce(new Error("db down"));
    await expect(login("ana", PASSWORD)).resolves.toHaveProperty("token");
  });

  it("does not touch a hash that is already current", async () => {
    const plain = { ...mfaUser(), totpEnabledAt: null };
    vi.mocked(userRepository.findByUsername).mockResolvedValue(plain as never);
    await login("ana", PASSWORD);
    expect(userRepository.upgradePasswordHash).not.toHaveBeenCalled();
  });
});
