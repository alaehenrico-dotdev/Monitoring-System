import type { NextFunction, Request, Response } from "express";
import { Role } from "@prisma/client";
import { verifyToken } from "../utils/jwt";
import { HttpError } from "../utils/HttpError";
import { asyncHandler } from "../utils/asyncHandler";
import { getOrSet } from "../lib/cache";
import { userRepository } from "../repositories/userRepository";

// A JWT's role/isActive claims are frozen at login time (see auth.service.ts)
// and the token itself has no way to reflect a later deactivation or role
// change until it naturally expires (JWT_EXPIRES_IN, default 8h) - so every
// authenticated request re-checks the DB, short-TTL cached to avoid hitting
// it on every single request. 30s keeps revocation effectively immediate
// relative to the token's lifetime while keeping the added DB load low.
const USER_STATUS_TTL_MS = 30_000;

/// Verifies the Bearer token, re-checks the user's current isActive/role
/// against the DB (see USER_STATUS_TTL_MS above), and attaches the result
/// to req.user.
async function authenticateHandler(req: Request, _res: Response, next: NextFunction) {
  const header = req.headers.authorization;
  if (!header?.startsWith("Bearer ")) {
    throw HttpError.unauthorized("Missing or malformed Authorization header");
  }
  const token = header.slice("Bearer ".length);
  let decoded;
  try {
    decoded = verifyToken(token);
  } catch {
    throw HttpError.unauthorized("Invalid or expired token");
  }

  const status = await getOrSet(`user-status:${decoded.id}`, USER_STATUS_TTL_MS, () =>
    userRepository.findStatus(decoded.id),
  );
  if (!status || !status.isActive) {
    throw HttpError.unauthorized("Account is no longer active");
  }

  req.user = { ...decoded, role: status.role };
  next();
}

export const authenticate = asyncHandler(authenticateHandler);

/// Restricts a route to one or more roles (Section 3.2 - User Roles).
export function authorize(...roles: Role[]) {
  return (req: Request, _res: Response, next: NextFunction) => {
    if (!req.user) throw HttpError.unauthorized();
    if (!roles.includes(req.user.role)) {
      throw HttpError.forbidden(`Requires role: ${roles.join(" or ")}`);
    }
    next();
  };
}

export const ROLES = Role;
