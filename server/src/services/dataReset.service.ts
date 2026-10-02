import crypto from "node:crypto";
import jwt from "jsonwebtoken";
import { env } from "../config/env";
import { prisma } from "../lib/prisma";
import { broadcastRealtimeEvent } from "../lib/realtime";
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

export function assertValidResetToken(token: string, user: AuthUser) {
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
 * Wipes all transactional data (stock entries, manual counts) and the
 * change log itself, leaving products/users/settings untouched. Runs as
 * one transaction so a failure partway through can't leave the system
 * half-wiped, and closes by writing a single new change-log entry recording
 * that the reset happened (who, when) - otherwise the very audit trail this
 * system relies on for accountability (changeLog.service.ts) would carry no
 * record that a reset ever occurred.
 */
export async function resetAllData(resetToken: string, user: AuthUser) {
  assertValidResetToken(resetToken, user);

  const result = await prisma.$transaction(async (tx) => {
    const onlineStock = await tx.dailyOnlineStock.deleteMany();
    const offlineStock = await tx.dailyOfflineStock.deleteMany();
    const manualCounts = await tx.manualCount.deleteMany();
    // Import History (Section: CSV import into Manual Count) - deleted
    // before change_log below, since its own rows reference change_log
    // entries (ChangeLog.importBatchId) that are about to disappear too; a
    // batch left over after this reset would otherwise find zero matching
    // entries if anyone ever tried to revert it, pointing at data that's
    // already gone.
    const importBatches = await tx.importBatch.deleteMany();
    const changeLog = await tx.changeLog.deleteMany();
    // Report History (Daily/Variance) - same "clean slate" reasoning the old
    // client-only localStorage version had (see reportHistory.ts's own
    // history in version control): a reopened entry here just re-fetches
    // live data for its date, so leaving one around after a reset would let
    // an admin "reopen" a report that's now empty.
    const reportHistory = await tx.reportHistoryEntry.deleteMany();

    const deleted = {
      onlineStock: onlineStock.count,
      offlineStock: offlineStock.count,
      manualCounts: manualCounts.count,
      importBatches: importBatches.count,
      changeLog: changeLog.count,
      reportHistory: reportHistory.count,
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

  broadcastRealtimeEvent();
  return result;
}
