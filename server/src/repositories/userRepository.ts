import { Prisma, Role } from "@prisma/client";
import { prisma, type Db } from "../lib/prisma";

const PUBLIC_USER_SELECT = {
  id: true,
  name: true,
  username: true,
  role: true,
  isActive: true,
  createdAt: true,
} as const;

export interface UserCreateData {
  name: string;
  username: string;
  passwordHash: string;
  role: Role;
}

/// Section 5.9 - users: login and role assignment.
export const userRepository = {
  findByUsername(username: string) {
    return prisma.user.findUnique({ where: { username } });
  },

  findById(id: number) {
    return prisma.user.findUnique({ where: { id } });
  },

  /// Lean projection for the per-request revocation check in
  /// middleware/auth.ts - runs on every cache-miss for an authenticated
  /// request, so it skips passwordHash and everything else findById pulls.
  findStatus(id: number) {
    return prisma.user.findUnique({ where: { id }, select: { isActive: true, role: true, tokenVersion: true, mustChangePassword: true } });
  },

  /// The two account-security flags /auth/me reports; a lean read, so nothing sensitive
  /// (the password hash, the TOTP secret) is loaded just to answer "who am I".
  findSecurityFlags(id: number) {
    return prisma.user.findUnique({ where: { id }, select: { mustChangePassword: true, totpEnabledAt: true } });
  },

  findAllPublic() {
    return prisma.user.findMany({ select: PUBLIC_USER_SELECT, orderBy: { name: "asc" } });
  },

  /// An account an admin creates starts with a temporary password the person must replace.
  create(data: UserCreateData, db: Db = prisma) {
    return db.user.create({ data: { ...data, mustChangePassword: true }, select: PUBLIC_USER_SELECT });
  },

  /// Also bumps tokenVersion, so every session opened with the old password
  /// stops working (see middleware/auth.ts).
  /// `mustChange`: true for an admin reset (the admin knows the new password, so the
  /// person has to replace it), false when the person chose it themselves.
  setPasswordHash(id: number, passwordHash: string, mustChange = true, db: Db = prisma) {
    return db.user.update({
      where: { id },
      // A new password also cancels any reset code that was waiting to be used.
      data: { passwordHash, mustChangePassword: mustChange, tokenVersion: { increment: 1 }, resetCodeHash: null, resetCodeExpiresAt: null, resetCodeAttempts: 0 },
      select: { id: true },
    });
  },

  /// Stores a freshly issued reset code (replacing any earlier one) with a clean attempt count.
  setResetCode(id: number, hash: string, expiresAt: Date) {
    return prisma.user.update({ where: { id }, data: { resetCodeHash: hash, resetCodeExpiresAt: expiresAt, resetCodeAttempts: 0 }, select: { id: true } });
  },

  /// A wrong guess at a live code. Once `maxAttempts` is reached the code is cancelled outright.
  async recordResetFailure(id: number, maxAttempts: number) {
    const { resetCodeAttempts } = await prisma.user.update({
      where: { id },
      data: { resetCodeAttempts: { increment: 1 } },
      select: { resetCodeAttempts: true },
    });
    if (resetCodeAttempts >= maxAttempts) {
      await prisma.user.update({ where: { id }, data: { resetCodeHash: null, resetCodeExpiresAt: null, resetCodeAttempts: 0 }, select: { id: true } });
    }
  },

  /// Spends the code and sets the new password in ONE conditional update: only a row that
  /// still holds exactly this hash, unexpired, can be consumed, so two requests racing with the
  /// same code cannot both win. Signs out every session (tokenVersion) and clears the
  /// forced-change flag, since the person just chose this password themselves.
  async consumeResetCode(id: number, hash: string, now: Date, passwordHash: string): Promise<boolean> {
    const r = await prisma.user.updateMany({
      where: { id, resetCodeHash: hash, resetCodeExpiresAt: { gt: now } },
      data: { passwordHash, mustChangePassword: false, tokenVersion: { increment: 1 }, resetCodeHash: null, resetCodeExpiresAt: null, resetCodeAttempts: 0 },
    });
    return r.count === 1;
  },

  /// "Sign out everywhere": every token issued so far stops working (see middleware/auth.ts).
  bumpTokenVersion(id: number) {
    return prisma.user.update({ where: { id }, data: { tokenVersion: { increment: 1 } }, select: { id: true, tokenVersion: true } });
  },

  /// Swaps in a stronger hash of the SAME password (see utils/password.ts needsRehash).
  /// No tokenVersion bump: nothing about the credentials changed for the person.
  upgradePasswordHash(id: number, passwordHash: string) {
    return prisma.user.update({ where: { id }, data: { passwordHash }, select: { id: true } });
  },

  setTotpPending(id: number, sealedSecret: string) {
    return prisma.user.update({
      where: { id },
      data: { totpSecret: sealedSecret, totpEnabledAt: null, totpLastStep: null, recoveryCodes: Prisma.DbNull },
      select: { id: true },
    });
  },

  enableTotp(id: number, step: number, recoveryHashes: string[]) {
    return prisma.user.update({
      where: { id },
      data: { totpEnabledAt: new Date(), totpLastStep: step, recoveryCodes: recoveryHashes },
      select: { id: true },
    });
  },

  disableTotp(id: number) {
    return prisma.user.update({
      where: { id },
      data: { totpSecret: null, totpEnabledAt: null, totpLastStep: null, recoveryCodes: Prisma.DbNull },
      select: { id: true },
    });
  },

  /// Marks a TOTP step as used, but only if it is newer than the last one - so two
  /// requests racing with the same code cannot both win.
  async consumeTotpStep(id: number, step: number): Promise<boolean> {
    const r = await prisma.user.updateMany({
      where: { id, OR: [{ totpLastStep: null }, { totpLastStep: { lt: step } }] },
      data: { totpLastStep: step },
    });
    return r.count === 1;
  },

  setRecoveryCodes(id: number, hashes: string[]) {
    return prisma.user.update({ where: { id }, data: { recoveryCodes: hashes }, select: { id: true } });
  },

  setActive(id: number, isActive: boolean, db: Db = prisma) {
    return db.user.update({ where: { id }, data: { isActive }, select: PUBLIC_USER_SELECT });
  },
};
