import crypto from "node:crypto";
import jwt from "jsonwebtoken";
import { env } from "../config/env";
import { prisma } from "../lib/prisma";
import { HttpError } from "../utils/HttpError";
import type { AuthUser } from "../types/express";

const RESET_TOKEN_SCOPE = "data-reset";
const RESET_TOKEN_TTL = "5m";

interface ResetTokenPayload extends jwt.JwtPayload {
  scope: typeof RESET_TOKEN_SCOPE;
  sub: string;
}

/// Fixed-time compare so a wrong passcode can't be narrowed down by timing
/// how long the comparison takes.
function passcodeMatches(input: string, expected: string): boolean {
  const a = Buffer.from(input);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

/**
 * Data Reset - passcode gate. A correct passcode earns a short-lived,
 * single-admin-scoped token that resetAllData then requires - this is what
 * actually enforces the passcode server-side, instead of it being a UI
 * screen that a request straight to the reset endpoint could skip.
 */
export function verifyPasscode(passcode: string, user: AuthUser): string | null {
  if (!passcodeMatches(passcode, env.dataResetPasscode)) return null;
  return jwt.sign({ scope: RESET_TOKEN_SCOPE, sub: String(user.id) }, env.jwtSecret, { expiresIn: RESET_TOKEN_TTL });
}

function assertValidResetToken(token: string, user: AuthUser) {
  let payload: ResetTokenPayload;
  try {
    payload = jwt.verify(token, env.jwtSecret) as ResetTokenPayload;
  } catch {
    throw HttpError.unauthorized("Reset passcode has expired - unlock this page again");
  }
  if (payload.scope !== RESET_TOKEN_SCOPE || payload.sub !== String(user.id)) {
    throw HttpError.forbidden("Invalid reset token");
  }
}

/**
 * Wipes all transactional data (stock entries, manual counts, receipts) and
 * the change log itself, leaving products/users/settings untouched. Runs as
 * one transaction so a failure partway through can't leave the system
 * half-wiped, and closes by writing a single new change-log entry recording
 * that the reset happened (who, when) - otherwise the very audit trail this
 * system relies on for accountability (changeLog.service.ts) would carry no
 * record that a reset ever occurred.
 */
export async function resetAllData(resetToken: string, user: AuthUser) {
  assertValidResetToken(resetToken, user);

  return prisma.$transaction(async (tx) => {
    const onlineStock = await tx.dailyOnlineStock.deleteMany();
    const offlineStock = await tx.dailyOfflineStock.deleteMany();
    const manualCounts = await tx.manualCount.deleteMany();
    // Deleting a receipt cascades to its items (schema.prisma ReceiptItem
    // onDelete: Cascade) - no separate receiptItem.deleteMany() needed.
    const receipts = await tx.receipt.deleteMany();
    const changeLog = await tx.changeLog.deleteMany();

    const deleted = {
      onlineStock: onlineStock.count,
      offlineStock: offlineStock.count,
      manualCounts: manualCounts.count,
      receipts: receipts.count,
      changeLog: changeLog.count,
    };

    await tx.changeLog.create({
      data: {
        tableName: "system",
        recordId: 0,
        action: "DELETE",
        changedById: user.id,
        newValue: { event: "data_reset", deleted },
      },
    });

    return { deleted };
  });
}
