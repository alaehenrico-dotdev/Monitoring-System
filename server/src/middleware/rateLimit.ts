import rateLimit, { ipKeyGenerator } from "express-rate-limit";
import type { Request } from "express";
import { env } from "../config/env";

/// All three limiters use express-rate-limit's default in-memory store.
/// That is deliberate while the API runs as a single pm2 process, but it
/// carries two consequences worth knowing before tuning any of this:
///   - Counters live in process memory, so every restart/deploy clears
///     them. A brute-force attempt can resume from zero after a restart.
///   - Nothing is shared between processes. Running a second API instance
///     (pm2 cluster mode, a second host behind a load balancer) would give
///     each one its own independent counters, effectively multiplying every
///     limit below by the number of instances.
/// Moving to a shared store (Redis, or a Prisma-backed store) is the fix for
/// both, and is only worth doing once more than one process actually runs.
///
/// Thresholds come from config/env.ts so a deployment can tune them without
/// a code change; the defaults are the values this shipped with.

/// Section: Security - request-overload prevention (OWASP API4:2023
/// "Unrestricted Resource Consumption"). A generous backstop across the
/// whole API - not meant to constrain normal use (a busy encoder's grid
/// saves/searches easily fire dozens of requests a minute), just to keep
/// one runaway client/script from monopolizing the server. Keyed by IP,
/// same as everything else here.
export const apiLimiter = rateLimit({
  windowMs: env.rateLimit.globalWindowMs,
  limit: env.rateLimit.globalLimit,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many requests - please slow down and try again shortly." },
});

/// Tighter limit on login specifically - the standard brute-force/
/// credential-stuffing guard. Counts every attempt (successes included via
/// default `skipSuccessfulRequests: false`) so a compromised account can't
/// be hammered indefinitely either.
///
/// Keyed by IP *and* submitted username rather than IP alone: this office
/// shares one public IP, so an IP-only key lets a single person fat-fingering
/// their password - or one attacker - spend the whole bucket and lock every
/// other encoder out of logging in. Per (IP, username) the lockout lands on
/// the account actually being hammered. An attacker cycling usernames from
/// one IP still gets a fresh bucket per username, so this trades a slower
/// username-spray guard for not denying service to real staff; apiLimiter
/// above is the ceiling that case runs into.
export const authLimiter = rateLimit({
  windowMs: env.rateLimit.loginWindowMs,
  limit: env.rateLimit.loginLimit,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many login attempts - please wait a few minutes and try again." },
  // `ipKeyGenerator` (not a bare req.ip) normalizes IPv6 to its /56 subnet,
  // so a client with a whole v6 range can't take a new key per request.
  keyGenerator: (req: Request) => {
    const username = typeof req.body?.username === "string" ? req.body.username.trim().toLowerCase() : "";
    return `${ipKeyGenerator(req.ip ?? "")}:${username}`;
  },
});

/// Data Reset's passcode (config/env.ts's DATA_RESET_PASSCODE) is a short,
/// human-typed code, not a full password - much lower entropy, guarding a
/// genuinely irreversible action, so it gets the same brute-force guard as
/// login rather than relying on the global limiter's much higher ceiling.
///
/// Keyed by IP only, unlike authLimiter above: there is no username in this
/// request to split the bucket by (the passcode is a single shared secret),
/// and the route mounts this limiter *before* `authenticate`, so there is no
/// req.user to key on either. Moving authenticate first would let an
/// unauthenticated flood reach JWT verification before being rate limited,
/// which is the worse trade.
export const passcodeLimiter = rateLimit({
  windowMs: env.rateLimit.passcodeWindowMs,
  limit: env.rateLimit.passcodeLimit,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many attempts - please wait a few minutes and try again." },
});
