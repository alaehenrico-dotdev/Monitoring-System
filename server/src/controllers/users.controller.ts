import type { Request, Response } from "express";
import { z } from "zod";
import { Role } from "@prisma/client";
import { createUser, issueResetCode, listUsers, resetUserPassword, setUserActive } from "../services/users.service";
import { HttpError } from "../utils/HttpError";
import { PASSWORD_MAX, PASSWORD_MIN } from "../utils/password";

const createSchema = z.object({
  name: z.string().min(1),
  username: z.string().min(3),
  // Length is checked here; the weak-password and "contains the username" rules in the service.
  password: z.string().min(PASSWORD_MIN, `Password must be at least ${PASSWORD_MIN} characters.`).max(PASSWORD_MAX),
  role: z.nativeEnum(Role),
});

export async function getUsers(_req: Request, res: Response) {
  res.json(await listUsers());
}

export async function postUser(req: Request, res: Response) {
  const parsed = createSchema.safeParse(req.body);
  if (!parsed.success) throw HttpError.badRequest("Invalid user payload", parsed.error.flatten());
  res.status(201).json(await createUser(parsed.data, req.user?.id));
}

// Capped at PASSWORD_MAX (see utils/password.ts) rather than letting a longer password
// be silently truncated by an older bcrypt hash of the same account.
const passwordSchema = z.object({
  password: z.string().min(PASSWORD_MIN, `Password must be at least ${PASSWORD_MIN} characters.`).max(PASSWORD_MAX),
});

export async function patchUserPassword(req: Request, res: Response) {
  const parsed = passwordSchema.safeParse(req.body);
  if (!parsed.success) throw HttpError.badRequest(parsed.error.issues[0]?.message ?? "Invalid payload", parsed.error.flatten());
  const userId = Number(req.params.id);
  if (!Number.isInteger(userId)) throw HttpError.badRequest("Invalid user id");
  await resetUserPassword(userId, parsed.data.password, req.user?.id);
  res.json({ success: true });
}

const activeSchema = z.object({ isActive: z.boolean() });

export async function patchUserActive(req: Request, res: Response) {
  const userId = Number(req.params.id);
  if (!Number.isInteger(userId)) throw HttpError.badRequest("Invalid user id");
  // Boolean("false") is true - require a real boolean rather than coercing.
  const parsed = activeSchema.safeParse(req.body);
  if (!parsed.success) throw HttpError.badRequest("isActive must be true or false");
  const { isActive } = parsed.data;
  // An admin deactivating their own account takes effect immediately (see
  // setUserActive) and can leave nobody able to sign in as an admin.
  if (!isActive && userId === req.user?.id) throw HttpError.badRequest("You cannot deactivate your own account");
  res.json(await setUserActive(userId, isActive, req.user?.id));
}

const resetCodeSchema = z.object({ password: z.string().min(1) });

/// Issues a one-time forgot-password code for an account. Needs the admin's own password.
export async function postUserResetCode(req: Request, res: Response) {
  const userId = Number(req.params.id);
  if (!Number.isInteger(userId)) throw HttpError.badRequest("Invalid user id");
  const parsed = resetCodeSchema.safeParse(req.body);
  if (!parsed.success) throw HttpError.badRequest("Your password is required to issue a reset code");
  res.json(await issueResetCode(userId, req.user!.id, parsed.data.password));
}
