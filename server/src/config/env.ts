import "dotenv/config";

function required(name: string, fallback?: string): string {
  const value = process.env[name] ?? fallback;
  if (value === undefined) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

// Well-known placeholder values - the .env.example sample values themselves
// (e.g. "000000", "change-this-to-a-long-random-string") plus former
// hardcoded defaults ("dev-secret-change-me", "127001") and other generic
// stand-ins nobody should actually run with. required() alone only catches
// a variable being *unset*; copying .env.example verbatim sets it to one of
// these instead, which would otherwise boot the server with the same
// silently-guessable value it's meant to prevent.
const PLACEHOLDER_SECRETS = new Set([
  "change-this-to-a-long-random-string",
  "dev-secret-change-me",
  "000000",
  "127001",
  "changeme",
  "change-me",
  "password",
  "secret",
]);

function requiredSecret(name: string, fallback?: string): string {
  const value = required(name, fallback);
  if (PLACEHOLDER_SECRETS.has(value.trim().toLowerCase())) {
    throw new Error(
      `Environment variable ${name} is set to a known placeholder value. Set a real, unique secret before starting the server - see .env.example.`,
    );
  }
  return value;
}

function duration(name: string, fallback: string, maxSeconds: number): string {
  const value = process.env[name] ?? fallback;
  const match = /^(\d+)(s|m|h|d)$/i.exec(value);
  if (!match) throw new Error(`${name} must be a duration such as 8h or 90d.`);
  const amount = Number(match[1]);
  const secondsPerUnit: Record<string, number> = { s: 1, m: 60, h: 3600, d: 86400 };
  const seconds = amount * secondsPerUnit[match[2].toLowerCase()];
  if (!Number.isSafeInteger(amount) || amount < 1 || seconds > maxSeconds) {
    throw new Error(`${name} must be between 1 second and ${maxSeconds} seconds.`);
  }
  return value;
}

/// Express's `trust proxy`, as an address allowlist rather than a hop count.
///
/// server.ts listens directly, so the API is reachable both through the
/// reverse proxy (Nginx, per PRODUCTION.md) and straight on its port. A hop
/// *count* like `1` trusts whatever the nearest sender claims, so a client
/// connecting directly could forge `X-Forwarded-For`, change `req.ip` at
/// will, and rotate its way around every IP-keyed limiter in
/// middleware/rateLimit.ts - including the login and passcode brute-force
/// guards. Trusting addresses instead means a forged header coming from an
/// untrusted peer is ignored and `req.ip` stays the real socket address.
///
/// Default "loopback": the local reverse proxy (Nginx) runs on this
/// same host, so it connects from 127.0.0.1 or ::1. Set TRUST_PROXY only if
/// a proxy fronts this API from a different address.
///
/// Accepted values:
///   loopback | linklocal | uniquelocal   Express's named presets
///   10.0.0.5, 192.168.0.0/16            one or more IPs/CIDRs (comma-separated)
///   false | none | off                  trust nothing (direct exposure)
///   true                                trust every hop - UNSAFE unless the
///                                       API is genuinely unreachable except
///                                       through a trusted proxy
function trustProxySetting(): boolean | string[] {
  const raw = process.env.TRUST_PROXY?.trim();
  if (!raw) return ["loopback"];
  const lowered = raw.toLowerCase();
  if (lowered === "false" || lowered === "none" || lowered === "off") return false;
  if (lowered === "true") return true;
  // A bare number is Express's hop-count form - the exact setting this
  // allowlist exists to replace, so it's rejected rather than silently
  // reintroducing the forgeable-header hole.
  if (/^\d+$/.test(raw)) {
    throw new Error(
      `TRUST_PROXY must name the proxy's address, not a hop count ("${raw}"). Use "loopback" for a local reverse proxy such as Nginx, or the proxy's IP/CIDR.`,
    );
  }
  const values = raw.split(",").map((v) => v.trim()).filter(Boolean);
  if (values.length === 0) throw new Error("TRUST_PROXY must be loopback, an IP/CIDR list, true or false.");
  return values;
}

/// Rate-limit thresholds (middleware/rateLimit.ts), overridable without a
/// code change so a deployment can be tuned from real traffic. The defaults
/// are the values this shipped with.
function limitCount(name: string, fallback: number): number {
  const raw = process.env[name]?.trim();
  if (!raw) return fallback;
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value < 1) throw new Error(`${name} must be a positive integer.`);
  return value;
}

function limitWindowMs(name: string, fallback: number): number {
  const raw = process.env[name]?.trim();
  if (!raw) return fallback;
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value < 1000) throw new Error(`${name} must be a whole number of milliseconds, at least 1000.`);
  return value;
}

function positivePort(): number {
  const port = Number(process.env.PORT ?? 4000);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error("PORT must be an integer from 1 to 65535.");
  return port;
}

export const env = {
  port: positivePort(),
  host: process.env.HOST?.trim() || "127.0.0.1",
  nodeEnv: process.env.NODE_ENV ?? "development",
  trustProxy: trustProxySetting(),
  rateLimit: {
    globalLimit: limitCount("RATE_LIMIT_GLOBAL_MAX", 600),
    globalWindowMs: limitWindowMs("RATE_LIMIT_GLOBAL_WINDOW_MS", 5 * 60 * 1000),
    loginLimit: limitCount("RATE_LIMIT_LOGIN_MAX", 10),
    loginWindowMs: limitWindowMs("RATE_LIMIT_LOGIN_WINDOW_MS", 15 * 60 * 1000),
    passcodeLimit: limitCount("RATE_LIMIT_PASSCODE_MAX", 10),
    passcodeWindowMs: limitWindowMs("RATE_LIMIT_PASSCODE_WINDOW_MS", 15 * 60 * 1000),
  },
  databaseUrl: required("DATABASE_URL"),
  // No fallback for either of these two: a default here would mean
  // `required()` never actually throws, so every token this app has ever
  // signed - and the passcode gating the irreversible data-reset endpoint -
  // could silently be running on a guessable, source-controlled value
  // (previously "dev-secret-change-me" / "127001") in any environment that
  // simply forgot to set them. Missing either now fails the server at boot
  // instead of failing open. See .env.example for what to set locally.
  jwtSecret: requiredSecret("JWT_SECRET"),
  jwtExpiresIn: duration("JWT_EXPIRES_IN", "8h", 30 * 24 * 60 * 60),
  clientOrigin: process.env.CLIENT_ORIGIN ?? "http://localhost:5173",
  dataResetPasscode: requiredSecret("DATA_RESET_PASSCODE"),
  // Full path to the mysqldump binary, for hosts (notably Windows) where the
  // MySQL client tools aren't on PATH. Defaults to plain "mysqldump".
  mysqldumpPath: process.env.MYSQLDUMP_PATH?.trim() || "mysqldump",
  // The `mysql` client used by Settings > Database Restore. Defaults to the
  // binary sitting next to mysqldump (same install), else plain "mysql".
  mysqlPath:
    process.env.MYSQL_PATH?.trim() ||
    (process.env.MYSQLDUMP_PATH ? process.env.MYSQLDUMP_PATH.trim().replace(/mysqldump(\.exe)?$/i, "mysql$1") : "mysql"),
};
