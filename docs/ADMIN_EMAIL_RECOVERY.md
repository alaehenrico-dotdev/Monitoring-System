# Admin Recovery Email (Forgot Password) - Implementation Guide

Goal: an **Admin** (`SUPERVISOR_ADMIN`) who forgot their password can get a one-time reset code
by email, using a **recovery email stored in the database**. Accounts stay in your own database;
Gmail is only used to **send** the email. No Google Cloud Console, no Google Sign-In, no Firebase.

> Scope: admin accounts only. Encoders and auditors keep the existing flow (an admin issues them a
> code from the Users page, or an Encoder with two-step verification resets with their authenticator).

---

## 0. How it fits what you already have

The project **already has** a forgot-password system built on a one-time code:

| Piece | Where |
|---|---|
| Code generation / hashing (10 chars, SHA-256, 30 min, 5 tries) | `server/src/utils/resetCode.ts` |
| Admin issues a code | `issueResetCode` in `server/src/services/users.service.ts` |
| User spends the code + new password | `resetPasswordWithCode` (same file), route `POST /auth/forgot-password/reset` |
| Storage | `users.resetCodeHash`, `resetCodeExpiresAt`, `resetCodeAttempts` |
| Rate limit | `resetCodeLimiter` in `server/src/middleware/rateLimit.ts` |
| Client page | `client/src/pages/ForgotPasswordPage.tsx`, route `/forgot-password` |
| Offline fallback | `npm run reset-password` (`server/src/cli/resetPassword.ts`) |

So you do **not** need a new reset-token table. The new work is only:

1. Store a **verified recovery email** on the user.
2. Add a way to **send mail** (`nodemailer` + Gmail SMTP).
3. Add `POST /auth/forgot-password/request`: for a verified admin it generates the *same* one-time code
   and **emails it** instead of showing it to another admin. The existing reset endpoint then spends it.
4. UI: "Email me a code" on the forgot page, and an email section in Account Settings.

```
Admin forgot password
  -> /forgot-password, enters username, clicks "Email me a code"
  -> POST /auth/forgot-password/request  (always answers the same neutral message)
       -> if active SUPERVISOR_ADMIN with VERIFIED email: make code, store hash, email it
  -> admin types code + new password
  -> POST /auth/forgot-password/reset   (existing, unchanged)
       -> password set, all sessions signed out (tokenVersion bump)
```

---

## 1. Decisions (already agreed)

- Admin-only recovery email. Enforced **on the server**, not only by hiding UI.
- Email must be **verified** (link sent to the new address) before it can be used for recovery.
- Changing the email requires the admin's **current password** (`assertAdminPassword`).
- Old address stays active until the new one is confirmed; the old address gets a "was changed" notice.
- A reset does **not** disable two-step verification.
- Sending: **Gmail SMTP + App Password** via `nodemailer`, behind one `sendMail()` function so it can be swapped
  for Resend/Brevo later by editing one file.
- Backup if email is down or the admin loses the mailbox: `npm run reset-password` on the server.

---

## 2. Prerequisites (do these first, outside the code)

1. **A dedicated sender Gmail**, e.g. `yourapp.noreply@gmail.com` (not a personal inbox).
2. Turn on **2-Step Verification** for it: Google Account -> Security -> 2-Step Verification.
3. Create an **App Password**: Google Account -> Security -> App passwords -> name it "Stocks server".
   You get a 16-character password. Copy it once; you can revoke it any time.
   - If the "App passwords" option is missing, the account is a Workspace account with it disabled, or 2-Step is off.
     Use a personal Gmail as the sender, or switch to Resend/Brevo (Section 13).
4. Know your **client URL**: production (`https://...`) and local (`http://localhost:5173`).
   It is already `CLIENT_ORIGIN` in the server env, and the reset/verify links use it.
5. **Production host must allow outbound port 465** (or 587). Some hosts block SMTP; check before deploying.

---

## 3. Install

```bash
cd server
npm i nodemailer
npm i -D @types/nodemailer
```

---

## 4. Server environment

Add to `server/.env` (and to the VPS `.env`; never commit it):

```env
# Recovery email (Gmail SMTP). Leave SMTP_USER empty to turn the feature off.
SMTP_HOST=smtp.gmail.com
SMTP_PORT=465
SMTP_USER=yourapp.noreply@gmail.com
SMTP_PASS=xxxxxxxxxxxxxxxx
MAIL_FROM="Ala Eh Stocks <yourapp.noreply@gmail.com>"
```

Also document them in `server/.env.example` (same style as the other entries, with empty values).

Read them in `server/src/config/env.ts`, inside the exported `env` object, following that file's helpers
(`required` / `requiredSecret`). They are **optional**, so read them with a plain fallback:

```ts
mail: {
  host: process.env.SMTP_HOST?.trim() || "smtp.gmail.com",
  port: Number(process.env.SMTP_PORT ?? 465),
  user: process.env.SMTP_USER?.trim() || "",
  pass: process.env.SMTP_PASS ?? "",
  from: process.env.MAIL_FROM?.trim() || process.env.SMTP_USER?.trim() || "",
},
```

If `SMTP_USER` is set, `SMTP_PASS` must be too. Add a startup check in the same style as the other config checks.
Add `SMTP_PASS` to whatever list masks secrets in logs, if the project keeps one.

---

## 5. Database

### 5.1 Schema (`server/prisma/schema.prisma`, model `User`)

Add next to the reset-code fields:

```prisma
  // Recovery email (admins only - enforced in the service). `email` only counts once
  // `emailVerifiedAt` is set. A change waits in `pendingEmail` until the link sent to it
  // is clicked (SHA-256 of the token in `emailVerifyHash`, valid until `emailVerifyExpiresAt`).
  email                String?   @unique @db.VarChar(254)
  emailVerifiedAt      DateTime?
  pendingEmail         String?   @db.VarChar(254)
  emailVerifyHash      String?   @db.VarChar(64)
  emailVerifyExpiresAt DateTime?
```

MySQL allows many `NULL`s in a unique column, so existing users are fine.

### 5.2 Migration

```bash
cd server
npx prisma migrate dev --create-only --name add_admin_recovery_email
```

Make `migration.sql` exactly:

```sql
-- Admin recovery email. Additive: nullable columns plus a unique index, no rows rewritten.
ALTER TABLE `users`
    ADD COLUMN `email` VARCHAR(254) NULL,
    ADD COLUMN `emailVerifiedAt` DATETIME(3) NULL,
    ADD COLUMN `pendingEmail` VARCHAR(254) NULL,
    ADD COLUMN `emailVerifyHash` VARCHAR(64) NULL,
    ADD COLUMN `emailVerifyExpiresAt` DATETIME(3) NULL;

CREATE UNIQUE INDEX `users_email_key` ON `users`(`email`);
```

Then apply it:

```bash
npx prisma migrate dev          # local
npm run migrate:docker          # docker setup (script exists in package.json)
npx prisma migrate deploy       # production
```

The repo has a migration guard (`scripts/check-migrations.mjs`, `server/prisma/reviewed-migrations.json`,
see `docs/OPERATIONS.md`). Read how it treats new migrations. This one is additive and safe; if the guard asks for a
note, add one line to `reviewed-migrations.json` for the new migration name.

---

## 6. Mail sender - `server/src/lib/mailer.ts` (new)

```ts
import nodemailer, { type Transporter } from "nodemailer";
import { env } from "../config/env";

let transporter: Transporter | null = null;

/// False when SMTP_USER is not set: recovery email is simply off.
export function mailConfigured(): boolean {
  return Boolean(env.mail.user && env.mail.pass);
}

function getTransporter(): Transporter {
  transporter ??= nodemailer.createTransport({
    host: env.mail.host,
    port: env.mail.port,
    secure: env.mail.port === 465, // 465 = TLS from the start, 587 = STARTTLS
    auth: { user: env.mail.user, pass: env.mail.pass },
    connectionTimeout: 10_000,
    socketTimeout: 15_000,
  });
  return transporter;
}

/// The ONLY place mail leaves the app. Swapping Gmail for Resend/Brevo means editing this file.
export async function sendMail(opts: { to: string; subject: string; text: string; html?: string }): Promise<void> {
  if (!mailConfigured()) throw new Error("Mail is not configured");
  await getTransporter().sendMail({ from: env.mail.from, ...opts });
}
```

Message builders go in `server/src/lib/mailTemplates.ts` (new). Keep them plain; never put the password in a mail.

```ts
import { env } from "../config/env";

const appName = "Ala Eh Stocks";

export function resetCodeMail(username: string, code: string, minutes: number) {
  const link = `${env.clientOrigin}/forgot-password?username=${encodeURIComponent(username)}`;
  return {
    subject: `${appName}: your password reset code`,
    text:
      `Someone asked to reset the password for "${username}".\n\n` +
      `Your one-time code: ${code}\n` +
      `It works once and expires in ${minutes} minutes.\n\n` +
      `Enter it here: ${link}\n\n` +
      `If this wasn't you, ignore this email - your password has not changed.`,
  };
}

export function verifyEmailMail(token: string) {
  const link = `${env.clientOrigin}/verify-email?token=${encodeURIComponent(token)}`;
  return {
    subject: `${appName}: confirm your recovery email`,
    text:
      `Confirm this address as the recovery email for your ${appName} admin account:\n\n${link}\n\n` +
      `The link works once and expires in 1 hour. If you didn't ask for this, ignore it.`,
  };
}

export function emailChangedMail(newEmail: string) {
  return {
    subject: `${appName}: your recovery email was changed`,
    text:
      `The recovery email on your ${appName} admin account was changed to ${newEmail}.\n` +
      `If this wasn't you, sign in and change your password now, then contact whoever runs the server.`,
  };
}
```

---

## 7. Repository additions - `server/src/repositories/userRepository.ts`

Add (same object style as the existing methods):

```ts
  findByEmail(email: string) {
    return prisma.user.findUnique({ where: { email } });
  },

  /// Starts an email change: parks the new address until its link is clicked.
  setPendingEmail(id: number, pendingEmail: string, hash: string, expiresAt: Date) {
    return prisma.user.update({
      where: { id },
      data: { pendingEmail, emailVerifyHash: hash, emailVerifyExpiresAt: expiresAt },
      select: { id: true },
    });
  },

  findByEmailVerifyHash(hash: string) {
    return prisma.user.findFirst({ where: { emailVerifyHash: hash } });
  },

  /// Makes the pending address the recovery email. One conditional update, so the same link
  /// can't be spent twice by racing requests.
  async confirmPendingEmail(id: number, hash: string, now: Date): Promise<boolean> {
    const user = await prisma.user.findUnique({ where: { id }, select: { pendingEmail: true } });
    if (!user?.pendingEmail) return false;
    const r = await prisma.user.updateMany({
      where: { id, emailVerifyHash: hash, emailVerifyExpiresAt: { gt: now } },
      data: {
        email: user.pendingEmail,
        emailVerifiedAt: now,
        pendingEmail: null,
        emailVerifyHash: null,
        emailVerifyExpiresAt: null,
      },
    });
    return r.count === 1;
  },
```

If `setPendingEmail` / `confirmPendingEmail` hit the unique index (another account took the address meanwhile),
catch Prisma error `P2002` in the service and answer "That email is already in use."

---

## 8. Service logic - `server/src/services/recoveryEmail.service.ts` (new)

Keep it separate from `users.service.ts` so the existing file stays readable.

```ts
import { createHash, randomBytes } from "node:crypto";
import { Role } from "@prisma/client";
import { z } from "zod";
import { userRepository } from "../repositories/userRepository";
import { assertAdminPassword } from "./adminPassword.service";
import { logSystemEvent } from "./changeLog.service";
import { HttpError } from "../utils/HttpError";
import { generateResetCode, hashResetCode, RESET_CODE_TTL_MS } from "../utils/resetCode";
import { mailConfigured, sendMail } from "../lib/mailer";
import { emailChangedMail, resetCodeMail, verifyEmailMail } from "../lib/mailTemplates";

const VERIFY_TTL_MS = 60 * 60 * 1000;
const RESEND_COOLDOWN_MS = 60 * 1000;
const emailSchema = z.string().trim().toLowerCase().email().max(254);

const sha256 = (s: string) => createHash("sha256").update(s).digest("hex");

/// Admin sets or changes THEIR OWN recovery email. Needs the current password.
export async function requestEmailChange(userId: number, rawEmail: unknown, password: string | undefined) {
  if (!mailConfigured()) throw HttpError.conflict("Email is not set up on this server.");
  const parsed = emailSchema.safeParse(rawEmail);
  if (!parsed.success) throw HttpError.badRequest("Enter a valid email address.");
  await assertAdminPassword(userId, password);

  const user = await userRepository.findById(userId);
  if (!user || !user.isActive || user.role !== Role.SUPERVISOR_ADMIN) throw HttpError.forbidden("Admins only.");
  const email = parsed.data;
  if (email === user.email) throw HttpError.conflict("That is already your recovery email.");
  const taken = await userRepository.findByEmail(email);
  if (taken && taken.id !== userId) throw HttpError.conflict("That email is already in use.");

  const token = randomBytes(32).toString("base64url");
  await userRepository.setPendingEmail(userId, email, sha256(token), new Date(Date.now() + VERIFY_TTL_MS));
  await sendMail({ to: email, ...verifyEmailMail(token) }); // to the NEW address
  await logSystemEvent("recovery_email_change_requested", { username: user.username }, userId, "UPDATE");
}

/// Public: the link in the verification mail. Possession of the mailbox is the proof.
export async function confirmEmail(token: unknown) {
  const invalid = () => HttpError.badRequest("This link is invalid or has expired. Request a new one.");
  if (typeof token !== "string" || token.length < 20 || token.length > 200) throw invalid();
  const hash = sha256(token);
  const user = await userRepository.findByEmailVerifyHash(hash);
  if (!user || !user.pendingEmail || !user.emailVerifyExpiresAt || user.emailVerifyExpiresAt <= new Date()) throw invalid();
  if (user.role !== Role.SUPERVISOR_ADMIN || !user.isActive) throw invalid();

  const oldEmail = user.email;
  const ok = await userRepository.confirmPendingEmail(user.id, hash, new Date());
  if (!ok) throw invalid();
  await logSystemEvent("recovery_email_confirmed", { username: user.username }, user.id, "UPDATE");
  if (oldEmail) void sendMail({ to: oldEmail, ...emailChangedMail(user.pendingEmail) }).catch(() => {});
}

/// Public. ALWAYS returns normally - the answer never says whether the account exists, is an
/// admin, or has an email. Mail is sent in the background so response time says nothing either.
export async function requestResetEmail(rawUsername: unknown, ip?: string) {
  const username = typeof rawUsername === "string" ? rawUsername.trim() : "";
  if (!username || username.length > 64 || !mailConfigured()) return;

  const user = await userRepository.findByUsername(username);
  const eligible =
    !!user && user.isActive && user.role === Role.SUPERVISOR_ADMIN && !!user.email && !!user.emailVerifiedAt;
  if (!eligible) {
    await logSystemEvent("password_reset_email_skipped", { username: username.slice(0, 64), ip: ip ?? null });
    return;
  }
  // One mail per minute per account: a code issued less than a minute ago is still the live one.
  const issuedAt = user.resetCodeExpiresAt ? user.resetCodeExpiresAt.getTime() - RESET_CODE_TTL_MS : 0;
  if (Date.now() - issuedAt < RESEND_COOLDOWN_MS) return;

  const code = generateResetCode();
  const expiresAt = new Date(Date.now() + RESET_CODE_TTL_MS);
  await userRepository.setResetCode(user.id, hashResetCode(code), expiresAt);
  await logSystemEvent("password_reset_email_sent", { username: user.username, ip: ip ?? null }, user.id, "UPDATE");
  void sendMail({ to: user.email!, ...resetCodeMail(user.username, code, RESET_CODE_TTL_MS / 60000) }).catch(() =>
    logSystemEvent("password_reset_email_failed", { username: user.username }, user.id, "UPDATE"),
  );
}
```

Adjust import paths and helper names to match the real files (e.g. `HttpError.forbidden/conflict/badRequest`
are used in `users.service.ts` already; `findById` / `findByUsername` exist in `userRepository`).

Why this is safe:
- The code is the same one the existing flow spends, so it is single-use, expires in 30 minutes, and dies after 5 wrong guesses.
- A reset runs `consumeResetCode`, which bumps `tokenVersion`, so every session (and the thief's, if any) is signed out.
- Two-step verification is untouched by a password reset.
- The email change is protected by password + a link sent to the new address, with a notice to the old one.

Also update the comment on `resetPasswordWithCode` in `users.service.ts`: an admin can now use a code issued by
email, not only one handed over by another admin.

---

## 9. Controllers and routes

### 9.1 `server/src/controllers/auth.controller.ts`

```ts
import { confirmEmail, requestEmailChange, requestResetEmail } from "../services/recoveryEmail.service";

/// Public, always the same answer.
export async function postForgotPasswordRequest(req: Request, res: Response) {
  await requestResetEmail(req.body?.username, req.ip);
  res.json({ success: true, message: "If that admin account has a verified recovery email, a code was sent to it." });
}

/// Signed-in admin: set or change MY recovery email.
export async function postRecoveryEmail(req: Request, res: Response) {
  await requestEmailChange(req.user!.id, req.body?.email, typeof req.body?.password === "string" ? req.body.password : undefined);
  res.json({ success: true });
}

/// Public: the link from the verification mail.
export async function postVerifyEmail(req: Request, res: Response) {
  await confirmEmail(req.body?.token);
  res.json({ success: true });
}
```

### 9.2 `server/src/routes/auth.routes.ts`

```ts
router.post("/forgot-password/request", loginIpLimiter, resetRequestLimiter, asyncHandler(postForgotPasswordRequest));
router.post("/email/verify", loginIpLimiter, resetCodeLimiter, asyncHandler(postVerifyEmail));
router.post("/recovery-email", authenticate, authorize(ROLES.SUPERVISOR_ADMIN), mfaLimiter, asyncHandler(postRecoveryEmail));
```

### 9.3 `server/src/middleware/rateLimit.ts`

Copy `resetCodeLimiter` as `resetRequestLimiter` with `new PrismaRateLimitStore("reset-request")` and a **tighter limit**
(e.g. 5 per 15 minutes per address+username). It stops someone using the form to spam an admin's inbox.
Check whether the store name needs registering anywhere (see how `"reset"` is used).

### 9.4 `/auth/me`

`getSecurityFlags` (users.service.ts) feeds `/auth/me`. Add `email` (the verified one) and `emailPending` (boolean),
so Account Settings can show state. Never return hashes.

Also: when the admin account is deactivated or the password is reset by CLI, clear any pending email / verify hash
(optional hardening).

---

## 10. Client

Files to touch: `client/src/api/auth.ts`, `client/src/pages/ForgotPasswordPage.tsx`,
`client/src/pages/AccountSettings.tsx`, `client/src/App.tsx`, a new `client/src/pages/VerifyEmailPage.tsx`.

### 10.1 API (`client/src/api/auth.ts`) - same style as the existing calls

```ts
export function requestResetEmail(username: string) {
  return http.post("/auth/forgot-password/request", { username });
}
export function setRecoveryEmail(email: string, password: string) {
  return http.post("/auth/recovery-email", { email, password });
}
export function verifyRecoveryEmail(token: string) {
  return http.post("/auth/email/verify", { token });
}
```

(Use whatever helper `resetPasswordWithCode` in that file uses, `http` is a placeholder.)

### 10.2 Forgot password page

Under the username field add a button **"Email me a code"**.
- On click: call `requestResetEmail(username)` and always show the neutral message:
  *"If that admin account has a verified recovery email, a code was sent. Check your inbox and spam."*
- Add a 60 s cooldown on the button (matches the server).
- Pre-fill the username from `?username=` (the email link uses it); the code and new-password fields stay as they are.
- Keep the existing line telling encoders/auditors to ask an administrator.

### 10.3 Account Settings (admin only)

Add a "Recovery email" card, shown only when `user.role === "SUPERVISOR_ADMIN"`:
- Shows current email + "Verified", or "Not set - password recovery by email is off".
- Form: new email + **current password** -> calls `setRecoveryEmail`.
- After submit: "We sent a confirmation link to <email>. Your current recovery email stays active until you click it."
- If `emailPending`, show "Waiting for confirmation" and let them resend.
- Style with the existing classes, then check every theme (see `client/src/styles/themes/*`). Use theme tokens, not hard-coded colors.

### 10.4 Verify page + route

`/verify-email?token=...` (public route like `/forgot-password`): on mount POST the token, show "Email confirmed, you can close this tab" or the error.
Guard against React StrictMode double-run (use a ref) so the single-use token isn't spent twice.
In `App.tsx` add: `<Route path="/verify-email" element={<VerifyEmailPage />} />` next to the forgot-password route.
Keep the token out of logs/analytics, and clear it from the URL with `history.replaceState` after reading.

### 10.5 Optional: onboarding prompt

After login, if the user is an admin with no verified email, show a dismissible banner "Add a recovery email so you can reset your password" that links to Account Settings.

---

## 11. Existing admin accounts

Nothing breaks: `email` is nullable. Each admin sets theirs once:

1. Sign in -> Account Settings -> Recovery email -> enter email + password.
2. Open the confirmation mail, click the link.
3. Test it once on a non-production moment: log out -> Forgot password -> Email me a code.

Until it is verified, forgot-password for that admin works only through `npm run reset-password` on the server
(or another admin issuing a code from the Users page, as today).

If there is a single admin, **set the email before you need it**, and keep SSH/server access as the last resort.

---

## 12. Tests

Follow the style of `server/src/services/passwordReset.test.ts` (read it first).

Server (`recoveryEmail.service.test.ts`, mock `sendMail`):
- ineligible users (encoder, auditor, inactive, no email, unverified email, unknown username) -> no mail sent, no error, same result;
- eligible admin -> exactly one mail, code works with `resetPasswordWithCode`, then is rejected the second time;
- second request within 60 s -> no second mail;
- `requestEmailChange`: wrong password -> 403; duplicate email -> 409; non-admin -> 403;
- `confirmEmail`: valid token swaps email and sets `emailVerifiedAt`; reused token fails; expired token fails; old address gets the notice;
- mail failure never changes the HTTP result of `requestResetEmail`.

Client (`ForgotPasswordPage.test.tsx`, `AccountSettings.test.tsx` already exist, extend them):
- "Email me a code" shows the neutral message regardless of the response;
- recovery email card is hidden for non-admins and asks for the password.

Run:

```bash
cd server && npm run typecheck && npx vitest run
cd ../client && npx tsc --noEmit -p . && npx vitest run
```

---

## 13. Production checklist

- [ ] Sender Gmail has 2-Step on and an App Password; `SMTP_*` and `MAIL_FROM` are in the VPS `.env` (see `docs/DEPLOY-VPS.md`).
- [ ] `CLIENT_ORIGIN` is the exact public https address (links in emails are built from it).
- [ ] Outbound 465/587 is open on the host and firewall.
- [ ] Migration applied with `prisma migrate deploy`.
- [ ] `trust proxy` is configured, so the rate limiters key on the real client IP (see `.env.example`).
- [ ] Each admin set and verified their email; one real "Email me a code" test done.
- [ ] `npm run reset-password` still works on the server (the fallback).
- [ ] Send failures are visible: `password_reset_email_failed` appears in the system log; someone checks it.
- [ ] App Password stored only in `.env`, rotated if anyone who knew it leaves.

**Switching away from Gmail later** (Resend, Brevo, any SMTP): only `server/src/lib/mailer.ts` and the `SMTP_*` values
change. For Resend, send with their HTTPS API instead of `nodemailer` (useful if the host blocks SMTP). You will need
a domain with SPF/DKIM records for good delivery.

---

## 14. Troubleshooting

| Symptom | Likely cause |
|---|---|
| `Invalid login` / `535` from Gmail | Not an App Password, 2-Step off, or spaces pasted in the password |
| `ETIMEDOUT` / `ECONNECTION` | Host blocks outbound 465/587 |
| Mail arrives in spam | Gmail sender is new; mark "not spam" once, or move to Resend/Brevo with your own domain |
| Link points to `localhost` | `CLIENT_ORIGIN` is not the public address |
| "Email me a code" always says it sent, nothing arrives | By design the answer is always the same; check the system log for `password_reset_email_skipped` (not eligible) or `..._failed` |
| Verify link says invalid | Expired (1 h), already used, or a newer change request replaced it |

---

## 15. Suggested order of work

1. Prerequisites (Section 2) and install (3).
2. Env (4), schema + migration (5), apply it.
3. Mailer + templates (6); send yourself a test mail from a scratch script.
4. Repository + service (7, 8) with tests (12).
5. Controllers, routes, limiter (9).
6. Client API, forgot page button, verify page (10.1 - 10.4).
7. Account Settings card, then check all themes (10.3).
8. Typecheck + tests on both sides, then deploy using Section 13.

Estimated effort: about a day including tests and theme checks.
