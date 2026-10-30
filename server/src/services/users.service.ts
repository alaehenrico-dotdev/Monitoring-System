import { Role } from "@prisma/client";
import { userRepository } from "../repositories/userRepository";
import { HttpError } from "../utils/HttpError";
import { invalidate } from "../lib/cache";
import { prisma } from "../lib/prisma";
import { hashPassword, passwordProblem } from "../utils/password";
import { issueSession } from "./auth.service";
import { assertAdminPassword } from "./adminPassword.service";
import { logSystemEvent, recordChange } from "./changeLog.service";

function assertAcceptablePassword(password: string, username: string) {
  const problem = passwordProblem(password, username);
  if (problem) throw HttpError.badRequest(problem);
}

/// The signed-in user changes their OWN password: needs the current one (so a stolen
/// session alone is not enough), and signs out every other session. Returns a fresh
/// token so this browser stays signed in.
export async function changeOwnPassword(userId: number, currentPassword: string | undefined, newPassword: string, remember = false) {
  await assertAdminPassword(userId, currentPassword);
  const user = await userRepository.findById(userId);
  if (!user) throw HttpError.notFound("User not found");
  if (newPassword === currentPassword) throw HttpError.badRequest("Choose a password different from the current one.");
  assertAcceptablePassword(newPassword, user.username);
  const passwordHash = await hashPassword(newPassword);
  const updated = await prisma.$transaction(async (tx) => {
    await userRepository.setPasswordHash(userId, passwordHash, false, tx);
    await recordChange(
      { tableName: "users", recordId: userId, action: "UPDATE", changedById: userId, newValue: { username: user.username, event: "password_changed" } },
      tx,
    );
    return tx.user.findUniqueOrThrow({ where: { id: userId } });
  });
  invalidate(`user-status:${userId}`);
  await logSystemEvent("password_changed", { username: user.username }, userId, "UPDATE");
  return issueSession(updated, remember);
}

/// Ends every session of the signed-in user on every device - a lost laptop, a shared
/// computer left signed in, a "remembered" device that is no longer trusted. Returns a
/// fresh token so the browser being used right now stays signed in.
export async function signOutEverywhere(userId: number, remember = false) {
  const updated = await userRepository.bumpTokenVersion(userId);
  invalidate(`user-status:${userId}`);
  await logSystemEvent("sign_out_everywhere", {}, userId, "UPDATE");
  const user = await userRepository.findById(userId);
  if (!user) throw HttpError.notFound("User not found");
  return issueSession({ ...user, tokenVersion: updated.tokenVersion }, remember);
}

/// What /auth/me adds to the token's identity: the two account-security flags.
export async function getSecurityFlags(userId: number) {
  const flags = await userRepository.findSecurityFlags(userId);
  return { mustChangePassword: flags?.mustChangePassword ?? false, mfaEnabled: Boolean(flags?.totpEnabledAt) };
}

export async function listUsers() {
  return userRepository.findAllPublic();
}

export async function createUser(data: { name: string; username: string; password: string; role: Role }, actorId?: number) {
  const existing = await userRepository.findByUsername(data.username);
  if (existing) throw HttpError.conflict(`Username "${data.username}" is already taken`);

  assertAcceptablePassword(data.password, data.username);
  const passwordHash = await hashPassword(data.password);
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
  assertAcceptablePassword(newPassword, user.username);
  const passwordHash = await hashPassword(newPassword);
  await prisma.$transaction(async (tx) => {
    await userRepository.setPasswordHash(userId, passwordHash, true, tx);
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
