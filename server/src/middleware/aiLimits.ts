import type { NextFunction, Request, RequestHandler, Response } from "express";
import rateLimit, { ipKeyGenerator } from "express-rate-limit";
import { env } from "../config/env";

/// The limits on the AI endpoints. Each AI request is a paid call (or several), so three guards sit in
/// front of every one, from the cheapest to refuse to the most general:
///
///  1. One at a time. A person's second request to the same feature while the first is still being
///     answered is refused at once, without spending anything. (The screens already wait for the answer;
///     this stops a second tab, a script, or a double click that slipped through.)
///  2. A short window: AI_RATE_LIMIT_MAX requests per 10 minutes per person per feature, so one burst of
///     questions does not use up another feature's allowance. The reply says how long to wait.
///  3. A daily allowance per person across all AI features (AI_USER_DAILY_LIMIT, default 100, 0 = off).
///     Without it one person at the short-window rate could use the server-wide daily cap
///     (AI_DAILY_CALL_LIMIT, lib/gemini.ts) that everyone shares, and lock the rest out for the day.
///
/// All three count per signed-in user, not per address: the office shares one address. They live in
/// memory, which is right for a single server process (ecosystem.config.cjs runs one): a restart only
/// resets counters that exist to limit spend, never anything a person has saved.

const WINDOW_MS = 10 * 60 * 1000;

const who = (req: Request): string => (req.user ? `user:${req.user.id}` : ipKeyGenerator(req.ip ?? ""));
const utcDay = (): string => new Date().toISOString().slice(0, 10);

/// "about a minute" / "about 7 minutes": a wait a person can plan around.
export function waitText(seconds: number): string {
  const minutes = Math.ceil(seconds / 60);
  return minutes <= 1 ? "about a minute" : `about ${minutes} minutes`;
}

// ---- 1. one at a time ------------------------------------------------------------------------------------
const running = new Set<string>();

function oneAtATime(feature: string): RequestHandler {
  return (req: Request, res: Response, next: NextFunction) => {
    const key = `${feature}:${who(req)}`;
    if (running.has(key)) {
      res.status(429).json({ error: "The AI is still working on your last question. Wait for the answer, then ask again." });
      return;
    }
    running.add(key);
    // "close" fires when the response ends however it ends (answer, error, refusal by a later guard, or
    // the browser giving up), so a slot can never be left taken.
    res.once("close", () => running.delete(key));
    next();
  };
}

// ---- 2. the short window ---------------------------------------------------------------------------------
function shortWindow(): RequestHandler {
  return rateLimit({
    windowMs: WINDOW_MS,
    limit: env.aiRateLimitMax,
    standardHeaders: true,
    legacyHeaders: false,
    keyGenerator: who,
    handler: (req: Request, res: Response) => {
      const resetTime = (req as Request & { rateLimit?: { resetTime?: Date } }).rateLimit?.resetTime;
      const seconds = Math.max(1, Math.ceil(((resetTime ? resetTime.getTime() : Date.now() + WINDOW_MS) - Date.now()) / 1000));
      res.setHeader("Retry-After", String(seconds));
      res.status(429).json({ error: `You've asked the AI a lot in a short time. Try again in ${waitText(seconds)}.` });
    },
  });
}

// ---- 3. the daily allowance ------------------------------------------------------------------------------
let daily = new Map<string, { day: string; count: number }>();

function dailyAllowance(): RequestHandler {
  return (req: Request, res: Response, next: NextFunction) => {
    const limit = env.aiUserDailyLimit ?? 0;
    if (limit <= 0) {
      next();
      return;
    }
    const key = who(req);
    const day = utcDay();
    let entry = daily.get(key);
    if (!entry || entry.day !== day) {
      // A new day: forget everyone's old counts so the map never grows past the people using it today.
      if (daily.size > 500) daily = new Map([...daily].filter(([, e]) => e.day === day));
      entry = { day, count: 0 };
      daily.set(key, entry);
    }
    if (entry.count >= limit) {
      res.status(429).json({ error: `You've used your ${limit} AI requests for today. The allowance resets tomorrow.` });
      return;
    }
    entry.count++;
    next();
  };
}

/// The three guards in order, as one middleware for a route. `feature` names its own short-window and
/// one-at-a-time bucket ("ask", "changes", "explain").
export function aiGuard(feature: string): RequestHandler {
  const steps = [oneAtATime(feature), shortWindow(), dailyAllowance()];
  return (req: Request, res: Response, next: NextFunction) => {
    let i = 0;
    const run = (err?: unknown): void => {
      if (err) return next(err);
      const step = steps[i++];
      if (!step) return next();
      void step(req, res, run);
    };
    run();
  };
}

/// For tests: forget every in-flight request and every daily count.
export function resetAiLimits(): void {
  running.clear();
  daily = new Map();
}
