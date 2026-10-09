import bcrypt from "bcryptjs";
import { userRepository } from "../repositories/userRepository";
import { signToken } from "../utils/jwt";
import { HttpError } from "../utils/HttpError";
import { env } from "../config/env";

/**
 * A real bcrypt hash of a value nobody can log in with, compared against
 * whenever the submitted username doesn't exist.
 *
 * Without it, login is a user-enumeration oracle: a miss returned as soon as
 * the SELECT came back (microseconds) while a hit spent ~100ms inside
 * bcrypt.compare. That difference is trivially measurable over the network,
 * so an attacker could map every valid username before attempting a single
 * password - which is exactly the list that makes the per-(IP, username)
 * login limiter in middleware/rateLimit.ts easier to work around, since a
 * known-good username is worth spending a whole bucket on.
 *
 * Generated once at module load rather than hardcoded, so the cost factor
 * always matches whatever bcrypt default this build uses - a stale constant
 * from an older, cheaper cost factor would leak the same timing difference
 * it exists to hide. `hashSync` is deliberate: it runs once at startup,
 * before the server accepts connections, not per request.
 */
const DUMMY_HASH = bcrypt.hashSync("password-that-matches-no-account", 10);

export async function login(username: string, password: string) {
  const user = await userRepository.findByUsername(username);

  // Always spend the bcrypt cost, even on a miss or a deactivated account,
  // so every failure path takes the same observable time. The result of the
  // dummy comparison is discarded - it can never be true.
  const valid = await bcrypt.compare(password, user?.passwordHash ?? DUMMY_HASH);

  // Checked only after the comparison above, so an inactive account is not
  // distinguishable from a wrong password by timing either.
  if (!user || !user.isActive || !valid) {
    throw HttpError.unauthorized("Invalid username or password");
  }

  const authUser = { id: user.id, username: user.username, name: user.name, role: user.role };
  const token = signToken(authUser, env.jwtExpiresIn);
  return { token, user: authUser };
}
