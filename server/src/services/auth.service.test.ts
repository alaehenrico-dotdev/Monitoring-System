import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../repositories/userRepository", () => ({
  userRepository: { findByUsername: vi.fn() },
}));
vi.mock("./changeLog.service", () => ({ logSystemEvent: vi.fn() }));

import bcrypt from "bcryptjs";
import { userRepository } from "../repositories/userRepository";
import { login } from "./auth.service";
import { logSystemEvent } from "./changeLog.service";
import { verifyToken } from "../utils/jwt";

const PASSWORD = "correct-horse-battery";
const HASH = bcrypt.hashSync(PASSWORD, 10);

function user(overrides: Record<string, unknown> = {}) {
  return {
    id: 7,
    username: "ana",
    name: "Ana Cruz",
    role: "ONLINE_ENCODER",
    passwordHash: HASH,
    isActive: true,
    ...overrides,
  };
}

beforeEach(() => vi.clearAllMocks());

describe("login - success", () => {
  it("returns a token carrying the user's identity and role", async () => {
    vi.mocked(userRepository.findByUsername).mockResolvedValue(user() as never);

    const result = await login("ana", PASSWORD);

    expect(result.user).toEqual({ id: 7, username: "ana", name: "Ana Cruz", role: "ONLINE_ENCODER" });
    expect(verifyToken(result.token)).toMatchObject({ id: 7, role: "ONLINE_ENCODER" });
  });

  it("never returns the password hash to the caller", async () => {
    vi.mocked(userRepository.findByUsername).mockResolvedValue(user() as never);

    const result = await login("ana", PASSWORD);

    expect(JSON.stringify(result)).not.toContain(HASH);
    expect(result.user).not.toHaveProperty("passwordHash");
  });
});

describe("login - failure", () => {
  it("rejects a wrong password", async () => {
    vi.mocked(userRepository.findByUsername).mockResolvedValue(user() as never);
    await expect(login("ana", "wrong")).rejects.toThrow("Invalid username or password");
  });

  it("rejects an unknown username", async () => {
    vi.mocked(userRepository.findByUsername).mockResolvedValue(null as never);
    await expect(login("nobody", PASSWORD)).rejects.toThrow("Invalid username or password");
  });

  it("rejects a deactivated account even with the right password", async () => {
    vi.mocked(userRepository.findByUsername).mockResolvedValue(user({ isActive: false }) as never);
    await expect(login("ana", PASSWORD)).rejects.toThrow("Invalid username or password");
  });

  it("gives every failure the same message, so none of them identifies the cause", async () => {
    const messages: string[] = [];
    const cases = [null, user({ isActive: false }), user()];
    const passwords = [PASSWORD, PASSWORD, "wrong"];

    for (let i = 0; i < cases.length; i++) {
      vi.mocked(userRepository.findByUsername).mockResolvedValue(cases[i] as never);
      await login("ana", passwords[i]).catch((e: Error) => messages.push(e.message));
    }

    expect(messages).toHaveLength(3);
    expect(new Set(messages).size).toBe(1);
  });
});

describe("login - user enumeration", () => {
  /**
   * The regression this guards: login used to return the instant the SELECT
   * came back empty, while an existing username spent ~100ms inside
   * bcrypt.compare. That timing gap let an attacker enumerate valid
   * usernames without ever guessing a password.
   *
   * Asserting on the bcrypt CALL rather than on wall-clock timing - a
   * duration assertion would be flaky on shared CI, while "did we spend the
   * hash cost on the miss path" is the actual invariant.
   */
  it("still performs a bcrypt comparison when the username does not exist", async () => {
    const compare = vi.spyOn(bcrypt, "compare");
    vi.mocked(userRepository.findByUsername).mockResolvedValue(null as never);

    await login("nobody", PASSWORD).catch(() => {});

    expect(compare).toHaveBeenCalledTimes(1);
    // Compared against a real hash, not an empty string - bcrypt returns
    // early on a malformed hash, which would reintroduce the timing gap.
    const [, hash] = compare.mock.calls[0];
    expect(String(hash)).toMatch(/^\$2[aby]\$\d{2}\$/);
    compare.mockRestore();
  });

  it("performs a bcrypt comparison on a deactivated account too", async () => {
    const compare = vi.spyOn(bcrypt, "compare");
    vi.mocked(userRepository.findByUsername).mockResolvedValue(user({ isActive: false }) as never);

    await login("ana", PASSWORD).catch(() => {});

    expect(compare).toHaveBeenCalledTimes(1);
    compare.mockRestore();
  });

  it("the dummy hash can never actually authenticate", async () => {
    vi.mocked(userRepository.findByUsername).mockResolvedValue(null as never);
    // Whatever is submitted, a missing user is never a successful login.
    for (const attempt of ["", PASSWORD, "password-that-matches-no-account"]) {
      await expect(login("nobody", attempt)).rejects.toThrow();
    }
  });
});

describe("login - audit trail", () => {
  it("logs a successful sign-in against the user", async () => {
    vi.mocked(userRepository.findByUsername).mockResolvedValue(user() as never);

    await login("ana", PASSWORD, "10.0.0.5");

    expect(logSystemEvent).toHaveBeenCalledWith("login", { username: "ana", ip: "10.0.0.5" }, 7);
  });

  it("logs a failed attempt with the username and address, never the password", async () => {
    vi.mocked(userRepository.findByUsername).mockResolvedValue(user() as never);

    await expect(login("ana", "wrong-password", "10.0.0.5")).rejects.toMatchObject({ status: 401 });

    expect(logSystemEvent).toHaveBeenCalledWith("login_failed", { username: "ana", ip: "10.0.0.5" });
    expect(JSON.stringify(vi.mocked(logSystemEvent).mock.calls)).not.toContain("wrong-password");
  });

  it("logs an unknown username too, truncated", async () => {
    vi.mocked(userRepository.findByUsername).mockResolvedValue(null);

    await expect(login("x".repeat(200), "whatever")).rejects.toMatchObject({ status: 401 });

    const [, details] = vi.mocked(logSystemEvent).mock.calls[0];
    expect((details as { username: string }).username).toHaveLength(64);
  });
});
