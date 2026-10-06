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

function positivePort(): number {
  const port = Number(process.env.PORT ?? 4000);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error("PORT must be an integer from 1 to 65535.");
  return port;
}

export const env = {
  port: positivePort(),
  nodeEnv: process.env.NODE_ENV ?? "development",
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
  // The Tauri desktop app gets a much longer-lived token than the web login
  // (auth.service.ts's login() picks between the two based on the request's
  // Origin - see app.ts's own Tauri-origin allowlist for the same three
  // values) - it's an installed app on a known company PC, not a browser tab
  // that might be on a shared/public machine, so staying logged in across
  // days/weeks is the actually-wanted behavior there, not a risk tradeoff
  // the short web expiry is protecting against.
  desktopJwtExpiresIn: duration("DESKTOP_JWT_EXPIRES_IN", "90d", 180 * 24 * 60 * 60),
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
