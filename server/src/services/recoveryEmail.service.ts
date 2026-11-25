import { createHash, randomBytes } from "node:crypto";
import { Prisma, Role } from "@prisma/client";
import { z } from "zod";
import { userRepository } from "../repositories/userRepository";
import { assertAdminPassword } from "./adminPassword.service";
import { logSystemEvent } from "./changeLog.service";
import { HttpError } from "../utils/HttpError";
import { generateResetCode, hashResetCode, RESET_CODE_TTL_MS } from "../utils/resetCode";
import { mailConfigured, sendMail } from "../lib/mailer";
import { emailChangedMail, emailChangeRequestedMail, passwordResetDoneMail, resetCodeMail, verifyEmailMail } from "../lib/mailTemplates";

const VERIFY_TTL_MS = 60 * 60 * 1000;
const RESEND_COOLDOWN_MS = 60 * 1000;
const emailSchema = z.string().trim().toLowerCase().email().max(254);

const sha256 = (s: string) => createHash("sha256").update(s).digest("hex");
const isUniqueViolation = (e: unknown) => e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002";

/// Logging a refusal must never turn into a second failure.
async function safeLog(event: string, details: Record<string, unknown>, userId?: number): Promise<void> {
  try {
    await logSystemEvent(event, details, userId, userId === undefined ? undefined : "UPDATE");
  } catch {
    // ignore
  }
}

/// An admin sets or changes THEIR OWN recovery email. Needs the current password (this controls who
/// can reset the account). The new address only counts once its link is clicked; the old one stays
/// active until then.
export async function requestEmailChange(userId: number, rawEmail: unknown, password: string | undefined) {
  if (!mailConfigured()) throw HttpError.conflict("Email is not set up on this server.");
  const parsed = emailSchema.safeParse(rawEmail);
  if (!parsed.success) throw HttpError.badRequest("Enter a valid email address.");
  await assertAdminPassword(userId, password);

  const user = await userRepository.findById(userId);
  if (!user || !user.isActive || user.role !== Role.SUPERVISOR_ADMIN) throw HttpError.forbidden("Only an administrator can set a recovery email.");
  const email = parsed.data;
  if (email === user.email) throw HttpError.conflict("That is already your recovery email.");
  const taken = await userRepository.findByEmail(email);
  if (taken && taken.id !== userId) throw HttpError.conflict("That email is already in use.");

  const token = randomBytes(32).toString("base64url");
  await userRepository.setPendingEmail(userId, email, sha256(token), new Date(Date.now() + VERIFY_TTL_MS));
  try {
    await sendMail({ to: email, ...verifyEmailMail(token) }); // to the NEW address
  } catch {
    await logSystemEvent("recovery_email_send_failed", { username: user.username }, userId, "UPDATE");
    throw HttpError.conflict("Couldn't send the confirmation email. Check the address and try again.");
  }
  await logSystemEvent("recovery_email_change_requested", { username: user.username }, userId, "UPDATE");
  // Warn the CURRENT address now, so a hijacked session can be noticed before the change completes.
  if (user.email && user.emailVerifiedAt) void sendMail({ to: user.email, ...emailChangeRequestedMail(maskEmail(email)) }).catch(() => {});
}

/// "jane.doe@example.com" -> "j***@example.com"
function maskEmail(email: string): string {
  const [local, domain] = email.split("@");
  return `${local.slice(0, 1)}***@${domain}`;
}

/// After a password was reset with an emailed code: tell the verified address. Fire and forget - it
/// must never affect the reset itself.
export function notifyPasswordReset(user: { email: string | null; emailVerifiedAt: Date | null; username: string }, ip?: string): void {
  if (!user.email || !user.emailVerifiedAt || !mailConfigured()) return;
  void sendMail({ to: user.email, ...passwordResetDoneMail(user.username, ip ?? null, new Date()) }).catch(() => {});
}

/// Public: the link in the verification mail. Possession of the mailbox is the proof.
export async function confirmEmail(token: unknown) {
  // Every refusal says the same thing to the caller, but the log records WHY (never the token), so a
  // link that "does nothing" can be diagnosed from the system log instead of guessed at.
  const refuse = async (reason: string, username?: string): Promise<never> => {
    await safeLog("recovery_email_verify_refused", { reason, username: username ?? null });
    throw HttpError.badRequest("This link is invalid or has expired. Request a new one from Account Settings.");
  };
  if (typeof token !== "string" || token.length < 20 || token.length > 200) return refuse("malformed_token");
  const hash = sha256(token);
  const user = await userRepository.findByEmailVerifyHash(hash);
  if (!user) return refuse("unknown_or_replaced_link");
  if (!user.pendingEmail || !user.emailVerifyExpiresAt) return refuse("nothing_pending", user.username);
  if (user.emailVerifyExpiresAt <= new Date()) return refuse("expired", user.username);
  if (user.role !== Role.SUPERVISOR_ADMIN || !user.isActive) return refuse("not_an_active_admin", user.username);

  const oldEmail = user.email;
  const newEmail = user.pendingEmail;
  let ok: boolean;
  try {
    ok = await userRepository.confirmPendingEmail(user.id, newEmail, hash, new Date());
  } catch (e) {
    if (isUniqueViolation(e)) {
      await safeLog("recovery_email_verify_refused", { reason: "email_taken", username: user.username }, user.id);
      throw HttpError.conflict("That email is already in use.");
    }
    throw e;
  }
  if (!ok) return refuse("lost_race", user.username);
  await logSystemEvent("recovery_email_confirmed", { username: user.username }, user.id, "UPDATE");
  if (oldEmail) void sendMail({ to: oldEmail, ...emailChangedMail(newEmail) }).catch(() => {});
}

/// Public. ALWAYS returns normally - the answer never says whether the account exists, is an admin
/// or has an email. The mail is sent in the background so the response time says nothing either.
export async function requestResetEmail(rawUsername: unknown, ip?: string) {
  const username = typeof rawUsername === "string" ? rawUsername.trim() : "";
  if (!username || username.length > 64 || !mailConfigured()) return;

  const user = await userRepository.findByUsername(username);
  if (!user || !user.isActive || user.role !== Role.SUPERVISOR_ADMIN || !user.email || !user.emailVerifiedAt) {
    await logSystemEvent("password_reset_email_skipped", { username: username.slice(0, 64), ip: ip ?? null });
    return;
  }
  // One mail a minute per account: a code issued less than a minute ago is still the live one.
  const issuedAt = user.resetCodeExpiresAt ? user.resetCodeExpiresAt.getTime() - RESET_CODE_TTL_MS : 0;
  if (Date.now() - issuedAt < RESEND_COOLDOWN_MS) return;

  const to = user.email;
  const code = generateResetCode();
  // The check above is only a cheap early exit; this conditional write is the real gate, so two
  // simultaneous requests cannot both issue a code and both send a mail.
  const now = Date.now();
  const won = await userRepository.issueResetCodeIfDue(
    user.id,
    hashResetCode(code),
    new Date(now + RESET_CODE_TTL_MS),
    new Date(now + RESET_CODE_TTL_MS - RESEND_COOLDOWN_MS),
  );
  if (!won) return;
  await logSystemEvent("password_reset_email_sent", { username: user.username, ip: ip ?? null }, user.id, "UPDATE");
  void sendMail({ to, ...resetCodeMail(user.username, code, RESET_CODE_TTL_MS / 60000) }).catch(async () => {
    try {
      await logSystemEvent("password_reset_email_failed", { username: user.username }, user.id, "UPDATE");
    } catch {
      // Logging the failure must never become a second failure.
    }
  });
}
