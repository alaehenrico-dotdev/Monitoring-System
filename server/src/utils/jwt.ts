import jwt from "jsonwebtoken";
import { env } from "../config/env";
import type { AuthUser } from "../types/express";

/**
 * Every token this API issues is HMAC-SHA256 signed with env.jwtSecret.
 *
 * Pinned explicitly on BOTH sign and verify. Without `algorithms` on verify,
 * jsonwebtoken accepts whatever the token's own header asks for - which is
 * the shape of the classic algorithm-confusion attack, where a token signed
 * with a different scheme (or, historically, `alg: none`) is presented
 * against a secret that was only ever meant to validate HS256. Modern
 * jsonwebtoken rejects `none` on its own, but pinning costs nothing and
 * removes the whole class rather than relying on the library's defaults
 * staying strict.
 */
const ALGORITHM = "HS256" as const;

export function signToken(user: AuthUser, expiresIn: string = env.jwtExpiresIn): string {
  return jwt.sign(user, env.jwtSecret, {
    algorithm: ALGORITHM,
    expiresIn: expiresIn as jwt.SignOptions["expiresIn"],
  });
}

export function verifyToken(token: string): AuthUser {
  return jwt.verify(token, env.jwtSecret, { algorithms: [ALGORITHM] }) as AuthUser;
}

/// Shared verify options for the one other place that validates a token
/// signed with the same secret (services/dataReset.service.ts's single-use
/// reset token), so both paths pin the same algorithm.
export const JWT_VERIFY_OPTIONS: jwt.VerifyOptions = { algorithms: [ALGORITHM] };
export const JWT_SIGN_ALGORITHM = ALGORITHM;
