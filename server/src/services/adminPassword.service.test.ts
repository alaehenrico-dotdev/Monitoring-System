import { beforeEach, describe, expect, it, vi } from "vitest";
import bcrypt from "bcryptjs";

const findById = vi.fn();
vi.mock("../repositories/userRepository", () => ({ userRepository: { findById: (id: number) => findById(id) } }));

import { assertAdminPassword } from "./adminPassword.service";

describe("assertAdminPassword", () => {
  beforeEach(() => {
    findById.mockReset();
    findById.mockResolvedValue({ passwordHash: bcrypt.hashSync("right-password", 4) });
  });

  it("accepts the user's own password", async () => {
    await expect(assertAdminPassword(1, "right-password")).resolves.toBeUndefined();
  });

  it("rejects a wrong or missing password with 403", async () => {
    await expect(assertAdminPassword(2, "nope")).rejects.toMatchObject({ status: 403 });
    await expect(assertAdminPassword(2, undefined)).rejects.toMatchObject({ status: 403 });
  });

  it("locks out after repeated misses, even for the right password", async () => {
    for (let i = 0; i < 5; i++) await assertAdminPassword(3, "bad").catch(() => {});
    await expect(assertAdminPassword(3, "right-password")).rejects.toMatchObject({ status: 429 });
  });
});
