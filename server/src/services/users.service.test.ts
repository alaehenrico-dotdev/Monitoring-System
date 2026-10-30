import { beforeEach, describe, expect, it, vi } from "vitest";

const tx = { fake: "tx" };
vi.mock("../lib/prisma", () => ({
  prisma: { $transaction: (cb: (t: unknown) => unknown) => cb(tx) },
}));
vi.mock("../lib/cache", () => ({ invalidate: vi.fn() }));
vi.mock("../repositories/userRepository", () => ({
  userRepository: { findByUsername: vi.fn(), findById: vi.fn(), create: vi.fn(), setActive: vi.fn(), findAllPublic: vi.fn(), setPasswordHash: vi.fn() },
}));
vi.mock("./changeLog.service", () => ({ recordChange: vi.fn() }));

import { userRepository } from "../repositories/userRepository";
import { recordChange } from "./changeLog.service";
import { verifyPassword } from "../utils/password";
import { invalidate } from "../lib/cache";
import { createUser, resetUserPassword, setUserActive } from "./users.service";

beforeEach(() => vi.clearAllMocks());

describe("createUser - audit trail", () => {
  it("logs the new account in the same transaction, without the password hash", async () => {
    vi.mocked(userRepository.findByUsername).mockResolvedValue(null);
    vi.mocked(userRepository.create).mockResolvedValue({ id: 12, name: "Ben", username: "ben", role: "ONLINE_ENCODER", isActive: true } as never);

    await createUser({ name: "Ben", username: "ben", password: "secret-pass", role: "ONLINE_ENCODER" }, 1);

    expect(userRepository.create).toHaveBeenCalledWith(expect.objectContaining({ username: "ben" }), tx);
    const [entry, db] = vi.mocked(recordChange).mock.calls[0];
    expect(db).toBe(tx);
    expect(entry).toMatchObject({ tableName: "users", recordId: 12, action: "CREATE", changedById: 1 });
    expect(JSON.stringify(entry)).not.toMatch(/passwordHash|secret-pass/);
  });

  it("logs nothing when the username is taken", async () => {
    vi.mocked(userRepository.findByUsername).mockResolvedValue({ id: 1 } as never);
    await expect(createUser({ name: "Ben", username: "ben", password: "secret-pass", role: "ONLINE_ENCODER" }, 1)).rejects.toMatchObject({ status: 409 });
    expect(recordChange).not.toHaveBeenCalled();
  });
});

describe("setUserActive - audit trail", () => {
  it("logs a deactivation with who did it", async () => {
    vi.mocked(userRepository.findById).mockResolvedValue({ id: 5, username: "cleo", isActive: true } as never);
    vi.mocked(userRepository.setActive).mockResolvedValue({ id: 5, isActive: false } as never);

    await setUserActive(5, false, 1);

    expect(recordChange).toHaveBeenCalledWith(
      expect.objectContaining({
        tableName: "users",
        recordId: 5,
        action: "UPDATE",
        changedById: 1,
        oldValue: { username: "cleo", isActive: true },
        newValue: { username: "cleo", isActive: false },
      }),
      tx,
    );
  });

  it("does not log a no-op toggle", async () => {
    vi.mocked(userRepository.findById).mockResolvedValue({ id: 5, username: "cleo", isActive: true } as never);
    vi.mocked(userRepository.setActive).mockResolvedValue({ id: 5, isActive: true } as never);

    await setUserActive(5, true, 1);

    expect(recordChange).not.toHaveBeenCalled();
  });
});

describe("resetUserPassword", () => {
  it("stores a hash of the new password and audits it without the secret", async () => {
    vi.mocked(userRepository.findById).mockResolvedValue({ id: 5, username: "ben" } as never);
    await resetUserPassword(5, "brand-new-pass", 1);
    const [id, hash, mustChange, db] = vi.mocked(userRepository.setPasswordHash).mock.calls[0];
    expect(id).toBe(5);
    expect(mustChange).toBe(true); // the admin knows it, so the person must replace it
    expect(db).toBe(tx);
    expect(hash).toMatch(/^scrypt\$\d+\$8\$\d+\$/); // current settings
    expect(await verifyPassword("brand-new-pass", hash)).toBe(true);
    const [entry] = vi.mocked(recordChange).mock.calls[0];
    expect(entry).toMatchObject({ tableName: "users", recordId: 5, action: "UPDATE", changedById: 1 });
    expect(JSON.stringify(entry)).not.toMatch(/brand-new-pass/);
    expect(JSON.stringify(entry)).not.toContain(hash);
  });

  it("drops the cached account status so the old sessions are refused at once", async () => {
    vi.mocked(userRepository.findById).mockResolvedValue({ id: 5, username: "ben" } as never);
    await resetUserPassword(5, "brand-new-pass", 1);
    expect(invalidate).toHaveBeenCalledWith("user-status:5");
  });

  it("refuses a weak or username-containing password before touching the database", async () => {
    vi.mocked(userRepository.findById).mockResolvedValue({ id: 5, username: "ben" } as never);
    await expect(resetUserPassword(5, "password123", 1)).rejects.toMatchObject({ status: 400 });
    await expect(resetUserPassword(5, "ben-is-the-best-1", 1)).rejects.toMatchObject({ status: 400 });
    expect(userRepository.setPasswordHash).not.toHaveBeenCalled();
  });

  it("404s for an unknown user", async () => {
    vi.mocked(userRepository.findById).mockResolvedValue(null);
    await expect(resetUserPassword(99, "brand-new-pass", 1)).rejects.toMatchObject({ status: 404 });
    expect(userRepository.setPasswordHash).not.toHaveBeenCalled();
  });
});
