import { createHash } from "node:crypto";
import type { NextFunction, Request, Response } from "express";
import { Prisma } from "@prisma/client";
import { prisma } from "../lib/prisma";
import { verifyToken } from "../utils/jwt";
import { HttpError } from "../utils/HttpError";
import { asyncHandler } from "../utils/asyncHandler";

const KEY_PATTERN = /^[A-Za-z0-9_-]{8,100}$/;
const IDEMPOTENCY_TTL_MS = 24 * 60 * 60 * 1000;
const MUTATING = new Set(["POST", "PUT", "PATCH", "DELETE"]);

function requestHash(req: Request): string {
  return createHash("sha256")
    .update(`${req.method} ${req.originalUrl}\n${JSON.stringify(req.body ?? null)}`)
    .digest("hex");
}

/// Best effort: the real authentication still happens on the route. Without a
/// valid token there is no one to scope a key to, so the request just runs.
function callerId(req: Request): number | null {
  const header = req.headers.authorization;
  if (!header?.startsWith("Bearer ")) return null;
  try {
    return verifyToken(header.slice("Bearer ".length)).id;
  } catch {
    return null;
  }
}

export async function purgeExpiredIdempotencyKeys(now = Date.now()): Promise<number> {
  const { count } = await prisma.idempotencyKey.deleteMany({ where: { createdAt: { lt: new Date(now - IDEMPOTENCY_TTL_MS) } } });
  return count;
}

/// Makes a save safe to retry. A client that sends the same `Idempotency-Key`
/// again (a double click, or a retry after a dropped connection where the first
/// attempt actually landed) gets the first attempt's response replayed instead
/// of the save running twice. The same key with a different request is a client
/// bug and is refused (422), as is a retry that races the original (409).
///
/// Only successful (< 400) results are remembered: a failure is worth running
/// again, since whatever caused it (a closed day, a validation message) may
/// have changed.
export const idempotency = asyncHandler(async (req: Request, res: Response, next: NextFunction) => {
  const key = req.header("idempotency-key");
  if (!key || !MUTATING.has(req.method)) return next();
  if (!KEY_PATTERN.test(key)) throw HttpError.badRequest("Invalid Idempotency-Key");
  const userId = callerId(req);
  if (userId === null) return next();

  const hash = requestHash(req);
  try {
    await prisma.idempotencyKey.create({
      data: { key, userId, method: req.method, path: req.originalUrl.slice(0, 300), requestHash: hash },
    });
  } catch (err) {
    if (!(err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002")) throw err;
    const prior = await prisma.idempotencyKey.findUnique({ where: { userId_key: { userId, key } } });
    if (!prior) return next(); // purged between the two queries - treat as new
    if (prior.requestHash !== hash) {
      throw new HttpError(422, "That Idempotency-Key was already used for a different request.");
    }
    if (prior.statusCode === null) {
      throw HttpError.conflict("The original request is still being processed - try again in a moment.");
    }
    res.setHeader("Idempotent-Replay", "true");
    res.status(prior.statusCode);
    if (prior.responseBody === null) res.end();
    else res.json(prior.responseBody);
    return;
  }

  let body: unknown = null;
  const json = res.json.bind(res);
  res.json = (b: unknown) => {
    body = b;
    return json(b);
  };
  res.on("finish", () => {
    const where = { userId_key: { userId, key } };
    const done =
      res.statusCode < 400
        ? prisma.idempotencyKey.update({
            where,
            data: { statusCode: res.statusCode, responseBody: body === null || body === undefined ? Prisma.JsonNull : (body as Prisma.InputJsonValue) },
          })
        : prisma.idempotencyKey.delete({ where });
    done.catch((err) => console.error("Could not settle idempotency key:", err));
  });
  // A dropped connection never reaches "finish"; free the key so a retry runs.
  res.on("close", () => {
    if (!res.writableFinished) {
      prisma.idempotencyKey.delete({ where: { userId_key: { userId, key } } }).catch(() => {});
    }
  });
  next();
});
