import type { Request, Response } from "express";
import { z } from "zod";
import { completeMfaLogin, login } from "../services/auth.service";
import { changeOwnPassword, getSecurityFlags, resetPasswordWithCode, signOutEverywhere } from "../services/users.service";
import { disableMfa, enableMfa, startMfaSetup } from "../services/mfa.service";
import { PASSWORD_MAX } from "../utils/password";
import { HttpError } from "../utils/HttpError";

const loginSchema = z.object({
  username: z.string().min(1),
  password: z.string().min(1),
  // The "Remember this device" tick: a longer session (REMEMBER_DEVICE_DAYS).
  rememberDevice: z.boolean().optional(),
});

export async function postLogin(req: Request, res: Response) {
  const parsed = loginSchema.safeParse(req.body);
  if (!parsed.success) throw HttpError.badRequest("Invalid credentials payload", parsed.error.flatten());

  const result = await login(parsed.data.username, parsed.data.password, req.ip, parsed.data.rememberDevice === true);
  res.json(result);
}

/// Who is signed in, plus the two account-security flags the app needs on every
/// screen: whether a password change is still required, and whether two-step is on.
export async function getMe(req: Request, res: Response) {
  res.json({ ...req.user, ...(await getSecurityFlags(req.user!.id)) });
}

const mfaLoginSchema = z.object({ mfaToken: z.string().min(1), code: z.string().min(1).max(32) });

export async function postMfaLogin(req: Request, res: Response) {
  const parsed = mfaLoginSchema.safeParse(req.body);
  if (!parsed.success) throw HttpError.badRequest("A verification code is required");
  res.json(await completeMfaLogin(parsed.data.mfaToken, parsed.data.code, req.ip));
}

// The new password's own rules (length floor, weak list, username) are enforced in the
// service; here only the shape and the 72-byte ceiling.
const changePasswordSchema = z.object({
  currentPassword: z.string().min(1),
  newPassword: z.string().min(1).max(PASSWORD_MAX),
  // Keeps a remembered device remembered, since the new token replaces the old one.
  rememberDevice: z.boolean().optional(),
});

export async function postChangePassword(req: Request, res: Response) {
  const parsed = changePasswordSchema.safeParse(req.body);
  if (!parsed.success) throw HttpError.badRequest("Current and new password are required");
  res.json(await changeOwnPassword(req.user!.id, parsed.data.currentPassword, parsed.data.newPassword, parsed.data.rememberDevice === true));
}

export async function postSignOutEverywhere(req: Request, res: Response) {
  res.json(await signOutEverywhere(req.user!.id, req.body?.rememberDevice === true));
}

export async function postMfaSetup(req: Request, res: Response) {
  res.json(await startMfaSetup(req.user!.id, typeof req.body?.password === "string" ? req.body.password : undefined));
}

export async function postMfaEnable(req: Request, res: Response) {
  const code = typeof req.body?.code === "string" ? req.body.code : "";
  res.json(await enableMfa(req.user!.id, code));
}

export async function postMfaDisable(req: Request, res: Response) {
  const password = typeof req.body?.password === "string" ? req.body.password : undefined;
  const code = typeof req.body?.code === "string" ? req.body.code : "";
  await disableMfa(req.user!.id, password, code);
  res.json({ success: true });
}

const forgotPasswordSchema = z.object({
  username: z.string().min(1).max(64),
  code: z.string().min(1).max(32),
  newPassword: z.string().min(1).max(PASSWORD_MAX),
});

/// Public (the person cannot sign in): username + the code an administrator issued + a new password.
export async function postForgotPasswordReset(req: Request, res: Response) {
  const parsed = forgotPasswordSchema.safeParse(req.body);
  if (!parsed.success) throw HttpError.badRequest("Username, reset code and new password are required");
  await resetPasswordWithCode(parsed.data.username.trim(), parsed.data.code, parsed.data.newPassword, req.ip);
  res.json({ success: true });
}
