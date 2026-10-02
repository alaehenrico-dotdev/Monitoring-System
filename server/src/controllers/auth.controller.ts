import type { Request, Response } from "express";
import { z } from "zod";
import { login } from "../services/auth.service";
import { HttpError } from "../utils/HttpError";
import { TAURI_ORIGINS } from "../config/tauriOrigins";

const loginSchema = z.object({
  username: z.string().min(1),
  password: z.string().min(1),
});

export async function postLogin(req: Request, res: Response) {
  const parsed = loginSchema.safeParse(req.body);
  if (!parsed.success) throw HttpError.badRequest("Invalid credentials payload", parsed.error.flatten());

  // A browser sends its real Origin on every request, including this one -
  // the installed desktop app gets a much longer-lived token (see
  // auth.service.ts's login()) than a web login does.
  const isDesktopClient = TAURI_ORIGINS.includes(req.headers.origin ?? "");
  const result = await login(parsed.data.username, parsed.data.password, isDesktopClient);
  res.json(result);
}

export async function getMe(req: Request, res: Response) {
  res.json(req.user);
}
