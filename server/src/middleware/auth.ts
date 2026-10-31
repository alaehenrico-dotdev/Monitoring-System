import type { NextFunction, Request, Response } from "express";
import { Role } from "@prisma/client";
import { verifyToken } from "../utils/jwt";
import { HttpError } from "../utils/HttpError";
import { asyncHandler } from "../utils/asyncHandler";
import { getOrSet, invalidate } from "../lib/cache";
import { userRepository } from "../repositories/userRepository";

// A JWT's role/isActive claims are frozen at login time (see auth.service.ts)
// and the token itself has no way to reflect a later deactivation or role
// change until it naturally expires (JWT_EXPIRES_IN, default 8h) - so every
// authenticated request re-checks the DB, short-TTL cached to avoid hitting
// it on every single request. 30s keeps revocation effectively immediate
// relative to the token's lifetime while keeping the added DB load low.
const USER_STATUS_TTL_MS = 30_000;

const PASSWORD_CHANGE_PATHS = new Set(["/api/auth/me", "/api/auth/change-password"]);

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

  const statusKey = `user-status:${decoded.id}`;
  const loadStatus = () => getOrSet(statusKey, USER_STATUS_TTL_MS, () => userRepository.findStatus(decoded.id));
  let status = await loadStatus();
  // A token can only carry a version the database has already reached. One NEWER than the
  // cached status therefore means the cache is stale: the account's credentials were changed
  // by something that could not clear this process's cache (the recovery commands run as
  // separate processes). Look again instead of turning the person away for up to 30 seconds -
  // which would hit exactly someone who has just recovered a locked-out account.
  if (status && (decoded.tv ?? 0) > status.tokenVersion) {
    invalidate(statusKey);
    status = await loadStatus();
  }
  if (!status || !status.isActive) {
    throw HttpError.unauthorized("Account is no longer active");
  }
  // A credential reset bumps the account's tokenVersion; a token issued
  // before that is no longer valid even though it has not expired.
  if ((decoded.tv ?? 0) !== status.tokenVersion) {
    throw HttpError.unauthorized("Your session has ended - please sign in again");
  }

  // A seeded account, or one an admin created or reset, still has a password somebody
  // else knows. Until the person replaces it, the only things they can do are look
  // themselves up and change it - so this is enforced here, not just by the screen.
  if (status.mustChangePassword && !PASSWORD_CHANGE_PATHS.has(req.originalUrl.split("?")[0].replace(/\/+$/, ""))) {
    throw HttpError.forbidden("You must change your password before continuing.");
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
