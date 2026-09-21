import rateLimit from "express-rate-limit";

/// Section: Security - request-overload prevention (OWASP API4:2023
/// "Unrestricted Resource Consumption"). A generous backstop across the
/// whole API - not meant to constrain normal use (a busy encoder's grid
/// saves/searches easily fire dozens of requests a minute), just to keep
/// one runaway client/script from monopolizing the server. Keyed by IP,
/// same as everything else here.
export const apiLimiter = rateLimit({
  windowMs: 5 * 60 * 1000,
  limit: 600,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many requests - please slow down and try again shortly." },
});

/// Tighter limit on login specifically - the standard brute-force/
/// credential-stuffing guard. Counts every attempt (successes included via
/// default `skipSuccessfulRequests: false`) so a compromised account can't
/// be hammered indefinitely either.
export const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many login attempts - please wait a few minutes and try again." },
});

/// Data Reset's passcode (config/env.ts's DATA_RESET_PASSCODE) is a short,
/// human-typed code, not a full password - much lower entropy, guarding a
/// genuinely irreversible action, so it gets the same brute-force guard as
/// login rather than relying on the global limiter's much higher ceiling.
export const passcodeLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many attempts - please wait a few minutes and try again." },
});
