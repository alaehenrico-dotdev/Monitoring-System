import { createHash } from "node:crypto";
import type { ClientRateLimitInfo, Options, Store } from "express-rate-limit";
import { prisma } from "../lib/prisma";

/// A rate-limit counter store backed by the `rate_limit_hits` table, used for the login-related
/// limiters so their counts survive a restart or deploy (the default in-memory store resets
/// to zero, which lets a brute-force attempt resume from nothing) and are shared if a second
/// API process is ever started.
///
/// Not used for the global API limiter: that runs on every request and is only a backstop.
///
/// One row per limiter and client key. The key is hashed because it can contain a
/// user-supplied username of any length, and so the table never holds a plain username.
/// Each limiter has its own prefix, because several of them are keyed by the same IP.
export class PrismaRateLimitStore implements Store {
  // Counters live in the database, so keys from one instance are valid in every other.
  localKeys = false;
  prefix: string;
  private windowMs = 15 * 60 * 1000;

  constructor(name: string) {
    this.prefix = `${name}:`;
  }

  init(options: Options): void {
    this.windowMs = options.windowMs;
  }

  private rowKey(key: string): string {
    return this.prefix + createHash("sha256").update(key).digest("hex").slice(0, 40);
  }

  async get(key: string): Promise<ClientRateLimitInfo | undefined> {
    const row = await prisma.rateLimitHit.findUnique({ where: { key: this.rowKey(key) } });
    if (!row || row.resetAt.getTime() <= Date.now()) return undefined;
    return { totalHits: row.hits, resetTime: row.resetAt };
  }

  async increment(key: string): Promise<ClientRateLimitInfo> {
    const rowKey = this.rowKey(key);
    const now = new Date();
    const resetAt = new Date(now.getTime() + this.windowMs);
    // One atomic statement: start a new window when the old one has run out, otherwise count on.
    // `hits` is assigned before `resetAt` on purpose: MySQL evaluates the assignments left to
    // right, so the expiry test for `hits` still sees the old `resetAt`.
    await prisma.$executeRaw`
      INSERT INTO rate_limit_hits (\`key\`, hits, resetAt) VALUES (${rowKey}, 1, ${resetAt})
      ON DUPLICATE KEY UPDATE
        hits = IF(resetAt <= ${now}, 1, hits + 1),
        resetAt = IF(resetAt <= ${now}, ${resetAt}, resetAt)`;
    const row = await prisma.rateLimitHit.findUniqueOrThrow({ where: { key: rowKey } });
    return { totalHits: row.hits, resetTime: row.resetAt };
  }

  async decrement(key: string): Promise<void> {
    await prisma.$executeRaw`UPDATE rate_limit_hits SET hits = GREATEST(hits - 1, 0) WHERE \`key\` = ${this.rowKey(key)}`;
  }

  async resetKey(key: string): Promise<void> {
    await prisma.rateLimitHit.deleteMany({ where: { key: this.rowKey(key) } });
  }
}

/// Housekeeping: windows that ended are of no use. Called from the nightly maintenance pass.
export async function purgeExpiredRateLimitHits(now = Date.now()): Promise<number> {
  const { count } = await prisma.rateLimitHit.deleteMany({ where: { resetAt: { lt: new Date(now) } } });
  return count;
}
