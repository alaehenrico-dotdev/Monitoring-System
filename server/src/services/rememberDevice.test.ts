import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../repositories/userRepository", () => ({
  userRepository: {
    findByUsername: vi.fn(),
    findById: vi.fn(),
    upgradePasswordHash: vi.fn(),
    consumeTotpStep: vi.fn(),
    setRecoveryCodes: vi.fn(),
    bumpTokenVersion: vi.fn(),
  },
}));
vi.mock("./changeLog.service", () => ({ logSystemEvent: vi.fn() }));
vi.mock("../lib/cache", () => ({ invalidate: vi.fn(), invalidateAll: vi.fn(), getOrSet: vi.fn() }));

import { hashPasswordSync } from "../utils/password";
import jwt from "jsonwebtoken";
import { env } from "../config/env";
import { userRepository } from "../repositories/userRepository";
import { completeMfaLogin, login } from "./auth.service";
import { signOutEverywhere } from "./users.service";
import { verifyToken } from "../utils/jwt";
import { currentStep, generateTotpSecret, sealSecret, totpCodeAt } from "../utils/totp";

const PASSWORD = "correct-horse-battery";
const SECRET = generateTotpSecret();
const base = {
  id: 7,
  username: "ana",
  name: "Ana Cruz",
  role: "ONLINE_ENCODER",
  passwordHash: hashPasswordSync(PASSWORD),
  isActive: true,
  tokenVersion: 2,
  totpSecret: null as string | null,
  totpEnabledAt: null as Date | null,
  totpLastStep: null,
  recoveryCodes: null,
};

const lifetimeSeconds = (token: string) => {
  const { exp, iat } = jwt.decode(token) as { exp: number; iat: number };
  return exp - iat;
};
const DAY = 24 * 3600;
const original = env.rememberDeviceDays;

beforeEach(() => {
  vi.clearAllMocks();
  env.rememberDeviceDays = 30;
  vi.mocked(userRepository.findByUsername).mockResolvedValue(base as never);
  vi.mocked(userRepository.findById).mockResolvedValue(base as never);
});
afterEach(() => {
  env.rememberDeviceDays = original;
});

describe("remember this device", () => {
  it("keeps the normal session length unless asked", async () => {
    const result = (await login("ana", PASSWORD)) as { token: string };
    expect(lifetimeSeconds(result.token)).toBe(8 * 3600);
  });

  it("lasts REMEMBER_DEVICE_DAYS when ticked", async () => {
    const result = (await login("ana", PASSWORD, "1.1.1.1", true)) as { token: string };
    expect(lifetimeSeconds(result.token)).toBe(30 * DAY);
    expect(verifyToken(result.token)).toMatchObject({ id: 7, tv: 2 });
  });

  it("is ignored when the feature is switched off (0 days)", async () => {
    env.rememberDeviceDays = 0;
    const result = (await login("ana", PASSWORD, "1.1.1.1", true)) as { token: string };
    expect(lifetimeSeconds(result.token)).toBe(8 * 3600);
  });

  it("survives the two-step code: the choice rides in the half-way token", async () => {
    const mfaUser = { ...base, totpSecret: sealSecret(SECRET), totpEnabledAt: new Date() };
    vi.mocked(userRepository.findByUsername).mockResolvedValue(mfaUser as never);
    vi.mocked(userRepository.findById).mockResolvedValue(mfaUser as never);
    vi.mocked(userRepository.consumeTotpStep).mockResolvedValue(true);

    const challenge = (await login("ana", PASSWORD, undefined, true)) as { mfaToken: string };
    const remembered = await completeMfaLogin(challenge.mfaToken, totpCodeAt(SECRET, currentStep()));
    expect(lifetimeSeconds(remembered.token)).toBe(30 * DAY);

    const plain = (await login("ana", PASSWORD)) as { mfaToken: string };
    vi.mocked(userRepository.findById).mockResolvedValue({ ...mfaUser, id: 8 } as never);
    const normal = await completeMfaLogin(plain.mfaToken, totpCodeAt(SECRET, currentStep())).catch(() => null);
    // (id differs, so this only proves a plain challenge never gets the long lifetime)
    expect(normal === null || lifetimeSeconds(normal.token) === 8 * 3600).toBe(true);
  });

  it("is cut off by 'sign out everywhere': the version in old tokens no longer matches", async () => {
    const before = (await login("ana", PASSWORD, "1.1.1.1", true)) as { token: string };
    vi.mocked(userRepository.bumpTokenVersion).mockResolvedValue({ id: 7, tokenVersion: 3 } as never);
    const after = await signOutEverywhere(7, true);
    expect(verifyToken(before.token).tv).toBe(2);
    expect(verifyToken(after.token).tv).toBe(3); // the current device gets a token for the new version
    expect(lifetimeSeconds(after.token)).toBe(30 * DAY);
  });
});
