import { Role } from "@prisma/client";
import { userRepository } from "../repositories/userRepository";
import { HttpError } from "../utils/HttpError";
import { invalidate } from "../lib/cache";
import { prisma } from "../lib/prisma";
import { hashPassword, passwordProblem } from "../utils/password";
import { DUMMY_RESET_HASH, generateResetCode, hashResetCode, RESET_CODE_TTL_MS, RESET_MAX_ATTEMPTS, sameResetHash } from "../utils/resetCode";
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

/// An administrator issues a one-time reset code for someone who forgot their password. It needs
/// the admin's own password again (this opens an account), replaces any earlier code for that
/// account, and is shown to the admin only now: only its hash is stored.
export async function issueResetCode(targetId: number, actorId: number, actorPassword: string | undefined) {
  await assertAdminPassword(actorId, actorPassword);
  const user = await userRepository.findById(targetId);
  if (!user) throw HttpError.notFound("User not found");
  if (!user.isActive) throw HttpError.conflict("That account is deactivated - reactivate it first.");
  const code = generateResetCode();
  const expiresAt = new Date(Date.now() + RESET_CODE_TTL_MS);
  await userRepository.setResetCode(targetId, hashResetCode(code), expiresAt);
  await logSystemEvent("password_reset_code_issued", { username: user.username, expiresAt: expiresAt.toISOString() }, actorId, "UPDATE");
  return { code, expiresAt };
}

/// Forgot password, from the login page: username + the code an administrator handed over + a
/// new password. Every way of being wrong (no such account, no code, expired, wrong, too many
/// guesses) gives the same answer, so this cannot be used to find out which usernames exist or
/// have a code outstanding. A wrong guess at a live code counts against it (5, then it is
/// cancelled); a new password that breaks the rules does NOT use the code up.
export async function resetPasswordWithCode(username: string, code: string, newPassword: string, ip?: string) {
  const invalid = () => HttpError.badRequest("That reset code is invalid or has expired. Ask your administrator for a new one.");
  const user = await userRepository.findByUsername(username);
  const now = new Date();
  const hasCode = !!user && !!user.resetCodeHash && !!user.resetCodeExpiresAt;
  // The comparison runs in every case, against a dummy when there is nothing real to compare.
  const matches = sameResetHash(hashResetCode(code), hasCode ? user!.resetCodeHash! : DUMMY_RESET_HASH);
  const live = hasCode && user!.isActive && user!.resetCodeExpiresAt! > now && user!.resetCodeAttempts < RESET_MAX_ATTEMPTS;

  if (!(matches && live)) {
    if (hasCode) await userRepository.recordResetFailure(user!.id, RESET_MAX_ATTEMPTS);
    // Only the attempted username and the address - never the code. Kept short so junk cannot bloat the log.
    await logSystemEvent("password_reset_failed", { username: username.slice(0, 64), ip: ip ?? null });
    throw invalid();
  }

  assertAcceptablePassword(newPassword, user!.username);
  const consumed = await userRepository.consumeResetCode(user!.id, user!.resetCodeHash!, now, await hashPassword(newPassword));
  if (!consumed) throw invalid();
  invalidate(`user-status:${user!.id}`);
  await logSystemEvent("password_reset_by_code", { username: user!.username, ip: ip ?? null }, user!.id, "UPDATE");
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
