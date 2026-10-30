import bcrypt from "bcryptjs";
import { randomBytes, scrypt, scryptSync, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";

/// New passwords are hashed with scrypt (Node's built-in, no extra package). It runs on
/// libuv's thread pool, so a login does not stall every other request the way bcryptjs
/// does (pure JavaScript: ~280 ms of blocked event loop per hash at cost 12). It is also
/// memory-hard, which blunts GPU guessing. N=2^15, r=8, p=3 is OWASP's equal-strength
/// setting for ~32 MiB. Hashes made before this (bcrypt) keep working and are replaced by a
/// scrypt hash the next time their owner signs in (see needsRehash).
//
/// Under the test runner (NODE_ENV=test, which vitest sets) a light setting is used, because
/// dozens of test workers hashing at full strength at once make the suite crawl. The tests
/// check the format and the upgrade logic, never the strength.
const SCRYPT = process.env.NODE_ENV === "test" ? ({ N: 2 ** 10, r: 8, p: 1 } as const) : ({ N: 2 ** 15, r: 8, p: 3 } as const);
const KEY_BYTES = 32;
const SALT_BYTES = 16;
// scrypt refuses to run above 32 MiB by default; this is what the parameters above need, with room.
const MAXMEM = 128 * 1024 * 1024;
// A stored hash is trusted data, but a corrupt or hostile row must not be able to ask for
// gigabytes: refuse parameters beyond a generous ceiling.
const MAX_N = 2 ** 18;

const scryptAsync = promisify(scrypt) as (pw: string, salt: Buffer, len: number, opts: object) => Promise<Buffer>;

export const PASSWORD_MIN = 10;
/// A ceiling, not a bcrypt quirk any more: it keeps absurd input out of the KDF. It is still
/// 72 so that a password valid today also works against the old bcrypt hash of the same
/// account until that is upgraded.
export const PASSWORD_MAX = 72;

const format = (salt: Buffer, key: Buffer) =>
  `scrypt$${SCRYPT.N}$${SCRYPT.r}$${SCRYPT.p}$${salt.toString("base64")}$${key.toString("base64")}`;

export async function hashPassword(plain: string): Promise<string> {
  const salt = randomBytes(SALT_BYTES);
  return format(salt, await scryptAsync(plain.normalize("NFKC"), salt, KEY_BYTES, { ...SCRYPT, maxmem: MAXMEM }));
}

/// Blocking version, for the one-time dummy hash at startup, seeds and tests.
export function hashPasswordSync(plain: string): string {
  const salt = randomBytes(SALT_BYTES);
  return format(salt, scryptSync(plain.normalize("NFKC"), salt, KEY_BYTES, { ...SCRYPT, maxmem: MAXMEM }));
}

function parseScrypt(stored: string) {
  const [tag, n, r, p, salt, key] = stored.split("$");
  if (tag !== "scrypt" || !key) return null;
  const params = { N: Number(n), r: Number(r), p: Number(p) };
  if (![params.N, params.r, params.p].every((v) => Number.isSafeInteger(v) && v > 0) || params.N > MAX_N || (params.N & (params.N - 1)) !== 0) return null;
  return { params, salt: Buffer.from(salt, "base64"), key: Buffer.from(key, "base64") };
}

/// Checks a password against either kind of stored hash. A malformed hash is simply a
/// non-match, never an exception.
export async function verifyPassword(plain: string, stored: string): Promise<boolean> {
  if (stored.startsWith("$2")) return bcrypt.compare(plain, stored); // legacy hash, upgraded at login
  const parsed = parseScrypt(stored);
  if (!parsed || parsed.key.length === 0) return false;
  const derived = await scryptAsync(plain.normalize("NFKC"), parsed.salt, parsed.key.length, { ...parsed.params, maxmem: MAXMEM });
  return derived.length === parsed.key.length && timingSafeEqual(derived, parsed.key);
}

/// True for a bcrypt hash, or a scrypt hash made with weaker settings than today's: to be
/// replaced after a successful login.
export function needsRehash(stored: string): boolean {
  const parsed = parseScrypt(stored);
  if (!parsed) return true;
  return parsed.params.N < SCRYPT.N || parsed.params.r < SCRYPT.r || parsed.params.p < SCRYPT.p;
}

// The passwords people actually pick, trimmed to those that clear the length floor
// (shorter ones fail on length already). Compared after lower-casing and stripping
// everything that is not a letter or digit, so "Password-123!" is caught too.
const COMMON = new Set(
  [
    "password", "password1", "password12", "password123", "password1234", "passw0rd", "p@ssw0rd", "p@ssword",
    "1234567890", "12345678910", "123456789", "0123456789", "0987654321", "1234512345", "1q2w3e4r5t", "1qaz2wsx3edc",
    "qwertyuiop", "qwerty123", "qwerty1234", "qwertyuiop123", "asdfghjkl", "asdfghjkl123", "zxcvbnm123", "iloveyou123",
    "iloveyou1", "letmein123", "welcome123", "welcome1234", "admin12345", "admin123456", "administrator", "adminadmin",
    "changeme123", "changeme", "abc1234567", "abcd123456", "abcdefghij", "monkey1234", "dragon1234", "football123",
    "baseball123", "superman123", "trustno1", "trustno123", "sunshine123", "princess123", "master1234", "login12345",
    "alaeh12345", "alaeh123456", "alaehstocks", "stocks12345", "inventory123", "guest12345", "default123", "test123456",
  ].map((p) => p.replace(/[^a-z0-9]/g, "")),
);

const squash = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");

/// Returns the reason a password is not acceptable, or null when it is. Length and
/// "not a known weak password" matter; forced symbols and case rules do not, since
/// they push people toward "Password1!" and make nothing safer.
export function passwordProblem(password: string, username?: string): string | null {
  if (password.length < PASSWORD_MIN) return `Password must be at least ${PASSWORD_MIN} characters.`;
  if (Buffer.byteLength(password, "utf8") > PASSWORD_MAX) return `Password must be at most ${PASSWORD_MAX} characters.`;
  const flat = squash(password);
  if (new Set(flat).size < 4) return "Password is too repetitive - use more different characters.";
  if (COMMON.has(flat)) return "That password is too common - choose something harder to guess.";
  const user = username ? squash(username) : "";
  if (user.length >= 3 && flat.includes(user)) return "Password must not contain the username.";
  return null;
}
