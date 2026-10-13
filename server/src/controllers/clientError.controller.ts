import type { Request, Response } from "express";
import { z } from "zod";
import { HttpError } from "../utils/HttpError";
import { verifyToken } from "../utils/jwt";
import { listClientErrors, recordClientError } from "../services/clientError.service";

const bodySchema = z.object({
  page: z.string().min(1).max(300),
  message: z.string().min(1).max(1000),
  stack: z.string().max(8000).optional(),
  source: z.enum(["boundary", "window", "promise", "manual"]),
  appVersion: z.string().max(40).optional(),
});

/// Open to a signed-out client too (a crash on the login page is still worth
/// seeing), so the user is read best-effort from the token rather than required.
function optionalUserId(req: Request): number | null {
  const header = req.headers.authorization;
  if (!header?.startsWith("Bearer ")) return null;
  try {
    return verifyToken(header.slice("Bearer ".length)).id;
  } catch {
    return null;
  }
}

export async function postClientError(req: Request, res: Response) {
  const parsed = bodySchema.safeParse(req.body);
  if (!parsed.success) throw HttpError.badRequest("Invalid error report", parsed.error.flatten());
  await recordClientError(
    { ...parsed.data, userAgent: req.headers["user-agent"] },
    optionalUserId(req),
  );
  res.status(204).end();
}

export async function getClientErrors(req: Request, res: Response) {
  const limit = Math.min(Math.max(Number(req.query.limit) || 50, 1), 200);
  const offset = Math.min(Math.max(Number(req.query.offset) || 0, 0), 1_000_000);
  res.json(await listClientErrors({ limit, offset }));
}
