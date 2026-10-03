import { Prisma, PrismaClient } from "@prisma/client";

// Single shared Prisma client instance for the whole API process.
export const prisma = new PrismaClient();

/// A repository/service function that takes this as its last argument (a
/// `Db`, defaulting to the shared `prisma` singleton) can run either
/// standalone or inside a caller's `prisma.$transaction(async (tx) => ...)`
/// - see sync.service.ts's pushChanges for why that matters (a push item's
/// delta and the idempotency marker that guards it need to commit or roll
/// back as one unit).
export type Db = PrismaClient | Prisma.TransactionClient;

/// Runs `fn` in a SERIALIZABLE transaction, retrying a bounded number of
/// times on a transaction conflict (MySQL/InnoDB error 1213/Prisma code
/// P2034). A plain (REPEATABLE READ, the default) transaction gives
/// atomicity - all its writes commit or roll back together - but NOT
/// protection against two concurrent transactions both reading the same
/// pre-write balance and both passing a check like the negative-stock guard
/// (dailyOnlineStock.service.ts/dailyOfflineStock.service.ts's
/// saveOnlineEntry/saveOfflineEntry, the only callers of this). Under
/// SERIALIZABLE, InnoDB turns their plain reads into locking reads, so the
/// second transaction to touch the same row blocks behind the first instead
/// of racing it - and if both still end up conflicting, one is aborted with
/// P2034 rather than silently letting stock go negative. That's expected,
/// not a bug, hence the retry: the aborted transaction re-reads the
/// now-current balance and re-checks the guard against it, same as if it
/// had simply been queued behind the other to begin with.
export async function serializableTransaction<T>(
  fn: (tx: Prisma.TransactionClient) => Promise<T>,
  attempts = 3,
): Promise<T> {
  for (let attempt = 1; ; attempt++) {
    try {
      return await prisma.$transaction(fn, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
    } catch (err) {
      const isConflict = err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2034";
      if (!isConflict || attempt >= attempts) throw err;
    }
  }
}
