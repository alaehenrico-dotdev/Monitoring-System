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

export const env = {
  port: Number(process.env.PORT ?? 4000),
  databaseUrl: required("DATABASE_URL"),
  // No fallback for either of these two: a default here would mean
  // `required()` never actually throws, so every token this app has ever
  // signed - and the passcode gating the irreversible data-reset endpoint -
  // could silently be running on a guessable, source-controlled value
  // (previously "dev-secret-change-me" / "127001") in any environment that
  // simply forgot to set them. Missing either now fails the server at boot
  // instead of failing open. See .env.example for what to set locally.
  jwtSecret: requiredSecret("JWT_SECRET"),
  jwtExpiresIn: process.env.JWT_EXPIRES_IN ?? "8h",
  clientOrigin: process.env.CLIENT_ORIGIN ?? "http://localhost:5173",
  receiptsAutoPostDefault: (process.env.RECEIPTS_AUTO_POST_DEFAULT ?? "true") === "true",
  dataResetPasscode: requiredSecret("DATA_RESET_PASSCODE"),
  // Encrypts the receipt id that goes into the printed receipt's QR code
  // (see utils/receiptQrToken.ts) - the one id in this app that actually
  // leaves the authenticated app, onto a piece of paper anyone can scan.
  receiptQrSecret: requiredSecret("RECEIPT_QR_SECRET"),
};
