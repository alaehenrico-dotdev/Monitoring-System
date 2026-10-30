import type { User } from "@prisma/client";
import { userRepository } from "../repositories/userRepository";
import { HttpError } from "../utils/HttpError";
import {
  generateRecoveryCodes,
  generateTotpSecret,
  hashRecoveryCode,
  openSecret,
  otpauthUrl,
  sealSecret,
  verifyTotp,
} from "../utils/totp";
import { assertAdminPassword } from "./adminPassword.service";
import { logSystemEvent } from "./changeLog.service";

// A 6-digit code has only a million values, so wrong guesses are counted per account
// (on top of the per-IP limiter on the route). One API process, so memory is enough.
const MAX_FAILURES = 5;
const LOCKOUT_MS = 15 * 60 * 1000;
const failures = new Map<number, { count: number; firstAt: number }>();

// One recovery code must open the door once. Spending it is read-modify-write on a JSON
// list, so two requests racing with the same code could both read it as unused. Requests for
// the same account are run one at a time, and the list is re-read inside the turn. (One API
// process - see the note above - so an in-memory queue is enough.)
const turns = new Map<number, Promise<unknown>>();
function inTurn<T>(userId: number, work: () => Promise<T>): Promise<T> {
  const run = (turns.get(userId) ?? Promise.resolve()).then(work, work);
  const tail = run.catch(() => undefined);
  turns.set(userId, tail);
  void tail.then(() => {
    if (turns.get(userId) === tail) turns.delete(userId);
  });
  return run;
}

function assertNotLocked(userId: number) {
  const entry = failures.get(userId);
  if (entry && Date.now() - entry.firstAt > LOCKOUT_MS) failures.delete(userId);
  if ((failures.get(userId)?.count ?? 0) >= MAX_FAILURES) {
    throw new HttpError(429, "Too many incorrect codes - try again in a few minutes");
  }
}

function noteFailure(userId: number) {
  const entry = failures.get(userId);
  failures.set(userId, { count: (entry?.count ?? 0) + 1, firstAt: entry?.firstAt ?? Date.now() });
}

/// True when `code` is a valid current authenticator code or an unused recovery code.
/// A code that works is spent (a TOTP step cannot be reused, a recovery code is removed).
export async function verifyMfaCode(user: Pick<User, "id" | "totpSecret" | "totpLastStep" | "recoveryCodes">, code: string): Promise<boolean> {
  assertNotLocked(user.id);
  const text = code.trim();
  if (user.totpSecret) {
    const step = verifyTotp(openSecret(user.totpSecret), text, user.totpLastStep ?? null);
    if (step !== null && (await userRepository.consumeTotpStep(user.id, step))) {
      failures.delete(user.id);
      return true;
    }
  }
  if (/^[A-Za-z0-9]{5}[\s-]?[A-Za-z0-9]{5}$/.test(text)) {
    const hash = hashRecoveryCode(text);
    const spent = await inTurn(user.id, async () => {
      const fresh = await userRepository.findById(user.id);
      const hashes = Array.isArray(fresh?.recoveryCodes) ? (fresh.recoveryCodes as string[]) : [];
      if (!hashes.includes(hash)) return null;
      await userRepository.setRecoveryCodes(user.id, hashes.filter((h) => h !== hash));
      return hashes.length - 1;
    });
    if (spent !== null) {
      failures.delete(user.id);
      await logSystemEvent("mfa_recovery_code_used", { remaining: spent }, user.id);
      return true;
    }
  }
  noteFailure(user.id);
  return false;
}

/// Step 1 of turning two-step verification on: needs the account password again, and
/// hands back a fresh secret (as text and as an otpauth:// link for the authenticator).
export async function startMfaSetup(userId: number, password: string | undefined) {
  await assertAdminPassword(userId, password);
  const user = await userRepository.findById(userId);
  if (!user) throw HttpError.notFound("User not found");
  if (user.totpEnabledAt) throw HttpError.conflict("Two-step verification is already on. Turn it off first to set it up again.");
  const secret = generateTotpSecret();
  await userRepository.setTotpPending(userId, sealSecret(secret));
  return { secret, otpauthUrl: otpauthUrl(secret, user.username) };
}

/// Step 2: the first valid code proves the authenticator really has the secret. Only
/// then does it turn on, and the recovery codes are shown (once).
export async function enableMfa(userId: number, code: string) {
  const user = await userRepository.findById(userId);
  if (!user?.totpSecret) throw HttpError.badRequest("Start the setup first.");
  if (user.totpEnabledAt) throw HttpError.conflict("Two-step verification is already on.");
  assertNotLocked(userId);
  const step = verifyTotp(openSecret(user.totpSecret), code, null);
  if (step === null) {
    noteFailure(userId);
    throw HttpError.badRequest("That code is not right - check the time on your phone and try the next code.");
  }
  const recoveryCodes = generateRecoveryCodes();
  await userRepository.enableTotp(userId, step, recoveryCodes.map(hashRecoveryCode));
  failures.delete(userId);
  await logSystemEvent("mfa_enabled", { username: user.username }, userId, "UPDATE");
  return { recoveryCodes };
}

/// Turning it off needs both the password and a current code, so a hijacked session
/// alone cannot strip the protection.
export async function disableMfa(userId: number, password: string | undefined, code: string) {
  await assertAdminPassword(userId, password);
  const user = await userRepository.findById(userId);
  if (!user?.totpEnabledAt) throw HttpError.badRequest("Two-step verification is not on.");
  if (!(await verifyMfaCode(user, code))) throw HttpError.forbidden("Incorrect verification code");
  await userRepository.disableTotp(userId);
  await logSystemEvent("mfa_disabled", { username: user.username }, userId, "UPDATE");
}
