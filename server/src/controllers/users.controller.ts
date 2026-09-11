import type { Request, Response } from "express";
import { z } from "zod";
import { Role } from "@prisma/client";
import { createUser, listUsers, setUserActive } from "../services/users.service";
import { HttpError } from "../utils/HttpError";

const createSchema = z.object({
  name: z.string().min(1),
  username: z.string().min(3),
  password: z.string().min(6),
  role: z.nativeEnum(Role),
});

export async function getUsers(_req: Request, res: Response) {
  res.json(await listUsers());
}

export async function postUser(req: Request, res: Response) {
  const parsed = createSchema.safeParse(req.body);
  if (!parsed.success) throw HttpError.badRequest("Invalid user payload", parsed.error.flatten());
  res.status(201).json(await createUser(parsed.data));
}

export async function patchUserActive(req: Request, res: Response) {
  const userId = Number(req.params.id);
  const isActive = Boolean(req.body?.isActive);
  res.json(await setUserActive(userId, isActive));
}
