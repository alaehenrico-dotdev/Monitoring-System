import rateLimit, { ipKeyGenerator } from "express-rate-limit";
import type { Request } from "express";
import { env } from "../config/env";
import { PrismaRateLimitStore } from "./rateLimitStore";

/// The global apiLimiter uses express-rate-limit's default in-memory store: it runs on every
/// request, is only a backstop, and losing its counts on a restart does no harm. Every
/// login-related limiter (login, failed-login-per-IP, two-step, forgot-password, data-reset
/// passcode) keeps its counters in the database (rateLimitStore.ts), so a restart or deploy
/// does not give a brute-force attempt a fresh start, and a second API process would share them.
///
/// How long a locked-out person should wait, for the messages below. Derived from the window
/// so it stays true when RATE_LIMIT_LOGIN_WINDOW_MS is tuned.
const waitText = () => {
  const mins = Math.max(1, Math.ceil(env.rateLimit.loginWindowMs / 60000));
  return mins === 1 ? "about a minute" : `about ${mins} minutes`;
};

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
  store: new PrismaRateLimitStore("login"),
  // Database unreachable: let the request through (sign-in itself needs the database anyway).
  passOnStoreError: true,
  windowMs: env.rateLimit.loginWindowMs,
  limit: env.rateLimit.loginLimit,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: `Too many login attempts - please wait ${waitText()} and try again.` },
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
/// A ceiling on FAILED logins per IP, whatever username they try. authLimiter above is
/// keyed by IP *and* username so one hammered account cannot lock out a whole office,
/// but that also gives every new username a fresh bucket - so one address could try a
/// password against every account (password spraying / username probing) and only the
/// global limiter would notice. Only failures count (`skipSuccessfulRequests`), so an
/// office behind one address signing in normally never reaches it.
export const loginIpLimiter = rateLimit({
  store: new PrismaRateLimitStore("loginip"),
  // Database unreachable: let the request through (sign-in itself needs the database anyway).
  passOnStoreError: true,
  windowMs: env.rateLimit.loginWindowMs,
  limit: env.rateLimit.loginIpLimit,
  standardHeaders: true,
  legacyHeaders: false,
  skipSuccessfulRequests: true,
  message: { error: `Too many failed login attempts from this address - please wait ${waitText()} and try again.` },
  keyGenerator: (req: Request) => ipKeyGenerator(req.ip ?? ""),
});

/// Second step of a two-step login. A code is only six digits, so this is tighter than
/// the password limiter; the per-account counter in services/mfa.service.ts backs it up.
/// Only FAILED codes count: this office shares one address, so several people signing in
/// correctly must not use up the bucket and block the next person at the code step.
export const mfaLimiter = rateLimit({
  store: new PrismaRateLimitStore("mfa"),
  // Database unreachable: let the request through (sign-in itself needs the database anyway).
  passOnStoreError: true,
  windowMs: env.rateLimit.loginWindowMs,
  limit: env.rateLimit.loginLimit,
  skipSuccessfulRequests: true,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: `Too many verification attempts - please wait ${waitText()} and try again.` },
  keyGenerator: (req: Request) => ipKeyGenerator(req.ip ?? ""),
});

/// Forgot password: the reset code is the only thing standing between a stranger and an
/// account, so guesses are limited per address AND per username, on top of the 5 wrong guesses
/// each code absorbs before it is cancelled (services/users.service.ts).
export const resetCodeLimiter = rateLimit({
  store: new PrismaRateLimitStore("reset"),
  // Database unreachable: let the request through (sign-in itself needs the database anyway).
  passOnStoreError: true,
  windowMs: env.rateLimit.loginWindowMs,
  limit: env.rateLimit.loginLimit,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: `Too many attempts - please wait ${waitText()} and try again.` },
  keyGenerator: (req: Request) => {
    const username = typeof req.body?.username === "string" ? req.body.username.trim().toLowerCase() : "";
    return `${ipKeyGenerator(req.ip ?? "")}:reset:${username}`;
  },
});

export const passcodeLimiter = rateLimit({
  store: new PrismaRateLimitStore("passcode"),
  // Database unreachable: let the request through (sign-in itself needs the database anyway).
  passOnStoreError: true,
  windowMs: env.rateLimit.passcodeWindowMs,
  limit: env.rateLimit.passcodeLimit,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many attempts - please wait a few minutes and try again." },
});
