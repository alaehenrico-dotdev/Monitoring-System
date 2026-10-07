import type { Request, Response } from "express";
import { z } from "zod";
import { login } from "../services/auth.service";
import { HttpError } from "../utils/HttpError";

const loginSchema = z.object({
  username: z.string().min(1),
  password: z.string().min(1),
});

export async function postLogin(req: Request, res: Response) {
  const parsed = loginSchema.safeParse(req.body);
  if (!parsed.success) throw HttpError.badRequest("Invalid credentials payload", parsed.error.flatten());

  const result = await login(parsed.data.username, parsed.data.password);
  res.json(result);
}

export async function getMe(req: Request, res: Response) {
  res.json(req.user);
}
