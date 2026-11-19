import { beforeEach, describe, expect, it, vi } from "vitest";

const tx = {};
const mocks = vi.hoisted(() => ({ removeAll: vi.fn() }));

vi.mock("../lib/prisma", () => ({ prisma: { $transaction: (cb: (t: unknown) => unknown) => cb(tx) } }));
vi.mock("../lib/cache", () => ({ invalidate: vi.fn() }));
vi.mock("../repositories/userRepository", () => ({
  userRepository: {
    findById: vi.fn(),
    setActive: vi.fn(),
    setPasswordHash: vi.fn(),
    bumpTokenVersion: vi.fn(),
  },
}));
vi.mock("./changeLog.service", () => ({ recordChange: vi.fn(), logSystemEvent: vi.fn() }));
vi.mock("./pushSubscriptions.service", () => ({ removeAllPushSubscriptions: mocks.removeAll }));
vi.mock("./auth.service", () => ({ issueSession: vi.fn().mockReturnValue({ token: "t" }) }));
vi.mock("./adminPassword.service", () => ({ assertAdminPassword: vi.fn() }));
vi.mock("./mfa.service", () => ({ verifyMfaCode: vi.fn() }));

import { userRepository } from "../repositories/userRepository";
import { changeOwnPassword, resetUserPassword, setUserActive, signOutEverywhere } from "./users.service";

const user = { id: 9, username: "maria", name: "Maria", role: "SUPERVISOR_ADMIN", isActive: true, tokenVersion: 0 };
const STRONG = "Correct-Horse-Battery-77!";

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(userRepository.findById).mockResolvedValue(user as never);
  vi.mocked(userRepository.setActive).mockResolvedValue({ ...user, isActive: false } as never);
  vi.mocked(userRepository.bumpTokenVersion).mockResolvedValue({ tokenVersion: 1 } as never);
  vi.mocked(userRepository.setPasswordHash).mockResolvedValue(undefined as never);
});

describe("alert devices follow the account's access", () => {
  it("are dropped when an account is deactivated, and not when it is reactivated", async () => {
    await setUserActive(9, false, 1);
    expect(mocks.removeAll).toHaveBeenCalledWith(9);
    mocks.removeAll.mockClear();
    await setUserActive(9, true, 1);
    expect(mocks.removeAll).not.toHaveBeenCalled();
  });

  it("are dropped when an admin resets the password", async () => {
    await resetUserPassword(9, STRONG, 1);
    expect(mocks.removeAll).toHaveBeenCalledWith(9);
  });

  it("are dropped when a person signs out everywhere", async () => {
    await signOutEverywhere(9);
    expect(mocks.removeAll).toHaveBeenCalledWith(9);
  });

  it("are dropped when a person changes their own password", async () => {
    vi.mocked(userRepository.findById).mockResolvedValue({ ...user, username: "maria" } as never);
    vi.mocked(userRepository.setPasswordHash).mockResolvedValue(undefined as never);
    // changeOwnPassword re-reads the user inside its transaction.
    (tx as Record<string, unknown>).user = { findUniqueOrThrow: vi.fn().mockResolvedValue(user) };
    await changeOwnPassword(9, "current-password-1!", STRONG);
    expect(mocks.removeAll).toHaveBeenCalledWith(9);
  });
});
