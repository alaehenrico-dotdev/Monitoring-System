import bcrypt from "bcryptjs";
import { userRepository } from "../repositories/userRepository";
import { HttpError } from "../utils/HttpError";

const MAX_FAILURES = 5;
const LOCKOUT_MS = 15 * 60 * 1000;
// One API process (see dataReset.service), so an in-memory counter is enough.
const failures = new Map<number, { count: number; firstAt: number }>();

/// Re-checks the signed-in user's own password before a sensitive action.
/// Throws 403 on a wrong or missing password (not 401, which the client treats
/// as an expired session) and 429 after repeated misses.
export async function assertAdminPassword(userId: number, password: string | undefined): Promise<void> {
  const now = Date.now();
  const entry = failures.get(userId);
  if (entry && now - entry.firstAt > LOCKOUT_MS) failures.delete(userId);
  const current = failures.get(userId);
  if (current && current.count >= MAX_FAILURES) {
    throw new HttpError(429, "Too many incorrect passwords - try again in a few minutes");
  }
  const user = await userRepository.findById(userId);
  const ok = !!password && !!user && (await bcrypt.compare(password, user.passwordHash));
  if (!ok) {
    failures.set(userId, { count: (current?.count ?? 0) + 1, firstAt: current?.firstAt ?? now });
    throw HttpError.forbidden("Incorrect password");
  }
  failures.delete(userId);
}
