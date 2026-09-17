import type { Request, Response } from "express";
import { z } from "zod";
import { HttpError } from "../utils/HttpError";
import { resetAllData, verifyPasscode } from "../services/dataReset.service";

const passcodeSchema = z.object({ passcode: z.string().min(1) });
const resetSchema = z.object({ resetToken: z.string().min(1) });

export async function postVerifyPasscode(req: Request, res: Response) {
  const parsed = passcodeSchema.safeParse(req.body);
  if (!parsed.success) throw HttpError.badRequest("Invalid passcode payload", parsed.error.flatten());

  const resetToken = verifyPasscode(parsed.data.passcode, req.user!);
  if (!resetToken) {
    res.json({ valid: false });
    return;
  }
  res.json({ valid: true, resetToken });
}

export async function postReset(req: Request, res: Response) {
  const parsed = resetSchema.safeParse(req.body);
  if (!parsed.success) throw HttpError.badRequest("Invalid reset payload", parsed.error.flatten());

  const result = await resetAllData(parsed.data.resetToken, req.user!);
  res.json({ success: true, ...result });
}
