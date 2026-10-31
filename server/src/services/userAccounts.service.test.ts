import { beforeEach, describe, expect, it, vi } from "vitest";

const tx = vi.hoisted(() => ({ user: { findMany: vi.fn(), update: vi.fn(), upsert: vi.fn() } }));
const db = vi.hoisted(() => ({ user: { findMany: vi.fn() }, $transaction: vi.fn() }));
vi.mock("../lib/prisma", () => ({ prisma: db }));
const invalidateAll = vi.hoisted(() => vi.fn());
vi.mock("../lib/cache", () => ({ invalidateAll }));

import { keepUserAccountsAcross } from "./userAccounts.service";

const mine = [
  { id: 1, name: "Admin", username: "admin", passwordHash: "H1", role: "SUPERVISOR_ADMIN", isActive: true, tokenVersion: 3, recoveryCodes: ["x"] },
  { id: 2, name: "Enc", username: "encoder", passwordHash: "H2", role: "ENCODER", isActive: true, tokenVersion: 0, recoveryCodes: null },
];

beforeEach(() => {
  vi.clearAllMocks();
  db.user.findMany.mockResolvedValue(mine);
  db.$transaction.mockImplementation(async (fn: (t: typeof tx) => Promise<unknown>) => fn(tx));
  tx.user.findMany.mockResolvedValue([
    { id: 1, username: "bob" }, // the backup's account 1 was somebody else
    { id: 2, username: "admin" }, // and its account 2 held a username this server uses
    { id: 9, username: "gone" }, // an account only the backup has
  ]);
});

describe("keepUserAccountsAcross (a database restore)", () => {
  it("puts this server's accounts back exactly, after the restore has run", async () => {
    const order: string[] = [];
    tx.user.upsert.mockImplementation(async () => order.push("upsert"));
    await keepUserAccountsAcross(async () => void order.push("restore"));
    expect(order).toEqual(["restore", "upsert", "upsert"]);
    expect(tx.user.upsert).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 1 }, update: expect.objectContaining({ username: "admin", passwordHash: "H1", tokenVersion: 3, role: "SUPERVISOR_ADMIN" }) }),
    );
    expect(tx.user.upsert).toHaveBeenCalledWith(expect.objectContaining({ where: { id: 2 }, create: expect.objectContaining({ id: 2, username: "encoder", passwordHash: "H2" }) }));
    expect(invalidateAll).toHaveBeenCalled();
  });

  it("deactivates and renames accounts that exist only in the backup, and frees usernames first", async () => {
    await keepUserAccountsAcross(async () => undefined);
    const updates = tx.user.update.mock.calls.map(([arg]) => arg);
    expect(updates).toContainEqual({ where: { id: 9 }, data: expect.objectContaining({ username: "gone.restored-9", isActive: false }) });
    expect(updates).toContainEqual({ where: { id: 1 }, data: { username: "~restore-1" } });
    expect(updates).toContainEqual({ where: { id: 2 }, data: { username: "~restore-2" } });
    // every rename happens before the first upsert
    expect(tx.user.update.mock.invocationCallOrder.at(-1)!).toBeLessThan(tx.user.upsert.mock.invocationCallOrder[0]);
  });

  it("restores the accounts even when the restore itself fails, and still reports that failure", async () => {
    await expect(keepUserAccountsAcross(async () => Promise.reject(new Error("mysql exited")))).rejects.toThrow("mysql exited");
    expect(tx.user.upsert).toHaveBeenCalledTimes(2);
  });

  it("never starts the restore if the accounts cannot be read", async () => {
    db.user.findMany.mockRejectedValue(new Error("db down"));
    const work = vi.fn();
    await expect(keepUserAccountsAcross(work)).rejects.toThrow("db down");
    expect(work).not.toHaveBeenCalled();
  });

  it("does not let a failed write-back hide the restore result", async () => {
    tx.user.upsert.mockRejectedValue(new Error("column missing"));
    const err = vi.spyOn(console, "error").mockImplementation(() => undefined);
    await expect(keepUserAccountsAcross(async () => 42)).resolves.toBe(42);
    expect(err).toHaveBeenCalled();
    err.mockRestore();
  });
});
