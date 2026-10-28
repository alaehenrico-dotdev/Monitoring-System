import { Prisma, PrismaClient } from "@prisma/client";

/**
 * Single shared Prisma client instance for the whole API process.
 *
 * CONNECTION POOL. Prisma sizes its pool as (physical CPUs * 2 + 1) unless
 * told otherwise, and that default is set from the *container/VM* CPU count.
 * On a small VPS sharing one MySQL server with anything else, several pm2
 * restarts or a second service can add up to more connections than MySQL's
 * own `max_connections` (151 by default) allows, and the symptom is
 * "Too many connections" at the worst moment rather than a slow queue.
 * Prisma takes this from the connection string, not from here, so it is set
 * in DATABASE_URL - see .env.example:
 *
 *     DATABASE_URL="mysql://user:pass@host:3306/db?connection_limit=10&pool_timeout=20"
 *
 * LOGGING. Warnings and errors are always surfaced so a failing query cannot
 * disappear silently. Full query logging is development-only: it prints every
 * statement with its parameters, which on this schema means stock figures and
 * usernames in the log, and it is far too noisy to leave on under real
 * traffic.
 */
export const prisma = new PrismaClient({
  log:
    process.env.NODE_ENV === "production"
      ? [{ emit: "stdout", level: "warn" }, { emit: "stdout", level: "error" }]
      : [{ emit: "stdout", level: "warn" }, { emit: "stdout", level: "error" }, { emit: "event", level: "query" }],
});

/// A repository/service function that takes this as its last argument (a
/// `Db`, defaulting to the shared `prisma` singleton) can run either
/// standalone or inside a caller's `prisma.$transaction(async (tx) => ...)`
/// - stock writes can compose repository operations while keeping the
/// associated stock changes and audit rows atomic.
export type Db = PrismaClient | Prisma.TransactionClient;

/// Runs `fn` in a SERIALIZABLE transaction, retrying a bounded number of
/// times on a transaction conflict (MySQL/InnoDB error 1213/Prisma code
/// P2034). A plain (REPEATABLE READ, the default) transaction gives
/// atomicity - all its writes commit or roll back together - but NOT
/// protection against two concurrent transactions both reading the same
/// pre-write row and each writing a Remaining Stock computed from it, so the
/// later commit silently overwrites the earlier one's effect (a lost update;
/// dailyOnlineStock.service.ts/dailyOfflineStock.service.ts's
/// saveOnlineEntry/saveOfflineEntry are the only callers of this). Under
/// SERIALIZABLE, InnoDB turns their plain reads into locking reads, so the
/// second transaction to touch the same row blocks behind the first instead
/// of racing it - and if both still end up conflicting, one is aborted with
/// P2034 rather than committing a figure built on a stale read. That's
/// expected, not a bug, hence the retry: the aborted transaction re-reads the
/// now-current row and recomputes from it, same as if it had simply been
/// queued behind the other to begin with. (Going below zero is not what this
/// protects against: negative stock is allowed on save - see isNegativeStock.)
export async function serializableTransaction<T>(
  fn: (tx: Prisma.TransactionClient) => Promise<T>,
  attempts = 3,
): Promise<T> {
  for (let attempt = 1; ; attempt++) {
    try {
      // timeout: propagating a corrected figure through months of later saved
      // periods is many sequential queries; the 5s default would roll back a
      // legitimate edit and surface it as an error.
      return await prisma.$transaction(fn, {
        isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
        timeout: 60_000,
        maxWait: 10_000,
      });
    } catch (err) {
      const isConflict = err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2034";
      if (!isConflict || attempt >= attempts) throw err;
    }
  }
}
