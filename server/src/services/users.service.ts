import bcrypt from "bcryptjs";
import { Role } from "@prisma/client";
import { userRepository } from "../repositories/userRepository";
import { HttpError } from "../utils/HttpError";
import { invalidate } from "../lib/cache";
import { prisma } from "../lib/prisma";
import { recordChange } from "./changeLog.service";

export async function listUsers() {
  return userRepository.findAllPublic();
}

export async function createUser(data: { name: string; username: string; password: string; role: Role }, actorId?: number) {
  const existing = await userRepository.findByUsername(data.username);
  if (existing) throw HttpError.conflict(`Username "${data.username}" is already taken`);

  const passwordHash = await bcrypt.hash(data.password, 10);
  // Logged in the same transaction as the account. The snapshot is the public
  // projection - never the password hash.
  return prisma.$transaction(async (tx) => {
    const created = await userRepository.create({ name: data.name, username: data.username, passwordHash, role: data.role }, tx);
    await recordChange(
      { tableName: "users", recordId: created.id, action: "CREATE", changedById: actorId, newValue: { name: created.name, username: created.username, role: created.role, isActive: created.isActive } },
      tx,
    );
    return created;
  });
}

/// Admin-only password reset (the route sits behind authorize(SUPERVISOR_ADMIN);
/// encoders cannot change passwords themselves). Only the hash is stored, and
/// the audit entry records that it happened - never the password or hash.
export async function resetUserPassword(userId: number, newPassword: string, actorId?: number) {
  const user = await userRepository.findById(userId);
  if (!user) throw HttpError.notFound("User not found");
  const passwordHash = await bcrypt.hash(newPassword, 10);
  await prisma.$transaction(async (tx) => {
    await userRepository.setPasswordHash(userId, passwordHash, tx);
    await recordChange(
      { tableName: "users", recordId: userId, action: "UPDATE", changedById: actorId, newValue: { username: user.username, event: "password_reset" } },
      tx,
    );
  });
  // The reset bumped the account's tokenVersion; drop the cached status so the
  // old sessions are refused immediately instead of after the cache TTL.
  invalidate(`user-status:${userId}`);
}

export async function setUserActive(userId: number, isActive: boolean, actorId?: number) {
  const user = await userRepository.findById(userId);
  if (!user) throw HttpError.notFound("User not found");
  const updated = await prisma.$transaction(async (tx) => {
    const next = await userRepository.setActive(userId, isActive, tx);
    if (user.isActive !== isActive) {
      await recordChange(
        { tableName: "users", recordId: userId, action: "UPDATE", changedById: actorId, oldValue: { username: user.username, isActive: user.isActive }, newValue: { username: user.username, isActive } },
        tx,
      );
    }
    return next;
  });
  // Deactivation should take effect immediately, not wait out
  // middleware/auth.ts's revocation-check TTL.
  invalidate(`user-status:${userId}`);
  return updated;
}
