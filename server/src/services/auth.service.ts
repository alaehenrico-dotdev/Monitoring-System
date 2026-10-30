import jwt from "jsonwebtoken";
import { hkdfSync } from "node:crypto";
import type { User } from "@prisma/client";
import { userRepository } from "../repositories/userRepository";
import { signToken } from "../utils/jwt";
import { HttpError } from "../utils/HttpError";
import { env } from "../config/env";
import { hashPassword, hashPasswordSync, needsRehash, verifyPassword } from "../utils/password";
import { logSystemEvent } from "./changeLog.service";
import { verifyMfaCode } from "./mfa.service";

/**
 * A real hash (of the kind new passwords get) of a value nobody can log in with,
 * compared against whenever the submitted username doesn't exist.
 *
 * Without it, login is a user-enumeration oracle: a miss returned as soon as
 * the SELECT came back (microseconds) while a hit spent ~100ms inside
 * the password check. That difference is trivially measurable over the network,
 * so an attacker could map every valid username before attempting a single
 * password - which is exactly the list that makes the per-(IP, username)
 * login limiter in middleware/rateLimit.ts easier to work around, since a
 * known-good username is worth spending a whole bucket on.
 *
 * Generated once at module load rather than hardcoded, so the cost factor
 * always matches the cost real hashes are made with - a stale constant from
 * an older, cheaper cost factor would leak the same timing difference it
 * exists to hide. `hashSync` is deliberate: it runs once at startup, before
 * the server accepts connections, not per request.
 */
const DUMMY_HASH = hashPasswordSync("password-that-matches-no-account");

// The half-way token between "password correct" and "second step done". It is signed
// with its OWN key (derived from JWT_SECRET) so it can never be presented as a session
// token: a session token verifies against jwtSecret itself, this one does not.
const mfaKey = () => Buffer.from(hkdfSync("sha256", env.jwtSecret, "ala-eh-mfa", "mfa challenge token v1", 32));
const MFA_TOKEN_TTL = "5m";

type AuthUserClaims = { id: number; username: string; name: string; role: User["role"] };

/// `remember`: the person ticked "Remember this device" - the session then lasts
/// REMEMBER_DEVICE_DAYS instead of JWT_EXPIRES_IN (unless that feature is switched off).
export function issueSession(user: Pick<User, "id" | "username" | "name" | "role" | "tokenVersion">, remember = false) {
  const authUser: AuthUserClaims = { id: user.id, username: user.username, name: user.name, role: user.role };
  const lifetime = remember && env.rememberDeviceDays > 0 ? `${env.rememberDeviceDays}d` : env.jwtExpiresIn;
  return { token: signToken(authUser, lifetime, user.tokenVersion), user: authUser };
}

export type LoginResult = { token: string; user: AuthUserClaims } | { mfaRequired: true; mfaToken: string };

export async function login(username: string, password: string, ip?: string, remember = false): Promise<LoginResult> {
  const user = await userRepository.findByUsername(username);

  // Always spend the hashing cost, even on a miss or a deactivated account,
  // so every failure path takes the same observable time. The result of the
  // dummy comparison is discarded - it can never be true.
  const valid = await verifyPassword(password, user?.passwordHash ?? DUMMY_HASH);

  // Checked only after the comparison above, so an inactive account is not
  // distinguishable from a wrong password by timing either.
  if (!user || !user.isActive || !valid) {
    // Only the attempted username and the address - never the password. Kept
    // short so a junk username cannot bloat the log.
    await logSystemEvent("login_failed", { username: username.slice(0, 64), ip: ip ?? null });
    throw HttpError.unauthorized("Invalid username or password");
  }

  // The password was right, so this is the moment to replace an older, cheaper hash
  // with one at today's cost. Best effort: a failure here must never fail the login.
  if (needsRehash(user.passwordHash)) {
    try {
      await userRepository.upgradePasswordHash(user.id, await hashPassword(password));
    } catch (err) {
      console.error("Could not upgrade password hash:", err);
    }
  }

  if (user.totpEnabledAt) {
    // `rem` rides along so the choice made on the password screen survives the code step.
    const mfaToken = jwt.sign({ id: user.id, purpose: "mfa", tv: user.tokenVersion, rem: remember }, mfaKey(), {
      algorithm: "HS256",
      expiresIn: MFA_TOKEN_TTL,
    });
    return { mfaRequired: true, mfaToken };
  }

  const session = issueSession(user, remember);
  await logSystemEvent("login", { username: user.username, ip: ip ?? null, ...(remember ? { remembered: true } : {}) }, user.id);
  return session;
}

/// Second step of a two-step login: the half-way token from `login` plus a 6-digit
/// code (or a one-time recovery code).
export async function completeMfaLogin(mfaToken: string, code: string, ip?: string) {
  const expired = () => HttpError.unauthorized("That sign-in step expired - please sign in again.");
  let claims: { id: number; purpose?: string; tv?: number; rem?: boolean };
  try {
    claims = jwt.verify(mfaToken, mfaKey(), { algorithms: ["HS256"] }) as typeof claims;
  } catch {
    throw expired();
  }
  if (claims.purpose !== "mfa") throw expired();

  const user = await userRepository.findById(claims.id);
  if (!user || !user.isActive || !user.totpEnabledAt || user.tokenVersion !== (claims.tv ?? 0)) throw expired();

  if (!(await verifyMfaCode(user, code))) {
    await logSystemEvent("mfa_failed", { username: user.username, ip: ip ?? null }, user.id);
    throw HttpError.unauthorized("Incorrect verification code");
  }

  const session = issueSession(user, claims.rem === true);
  await logSystemEvent("login", { username: user.username, ip: ip ?? null, mfa: true, ...(claims.rem ? { remembered: true } : {}) }, user.id);
  return session;
}
