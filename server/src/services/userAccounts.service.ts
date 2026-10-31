import { Prisma } from "@prisma/client";
import { prisma } from "../lib/prisma";
import { invalidateAll } from "../lib/cache";

type Account = Awaited<ReturnType<typeof prisma.user.findMany>>[number];

/// A database restore replaces every table, `users` included - so restoring an older backup
/// would bring back old passwords, old roles, old MFA settings and accounts that no longer
/// exist, and quietly lock people out (or let a removed account back in). This runs `work`
/// (the restore plus the migrations that bring the file up to this version) and then puts the
/// accounts back exactly as this server had them: passwords, roles, MFA, active flag and
/// sessions (tokenVersion).
///
/// Accounts that exist only in the backup are NOT deleted - old entries still point at them -
/// but they are deactivated, and renamed if their username is now taken, so nobody can sign in
/// with them. An entry the backup attributes to an account id that this server also uses is
/// shown under the current account of that id.
export async function keepUserAccountsAcross<T>(work: () => Promise<T>): Promise<T> {
  // Read before anything is touched: if this fails, the restore never starts.
  const before = await prisma.user.findMany();
  try {
    return await work();
  } finally {
    try {
      await putAccountsBack(before);
    } catch (err) {
      console.error(JSON.stringify({ level: "error", event: "user-accounts-keep-failed", message: err instanceof Error ? err.message : String(err) }));
    }
    invalidateAll();
  }
}

async function putAccountsBack(before: Account[]): Promise<void> {
  const keep = new Map(before.map((u) => [u.id, u]));
  await prisma.$transaction(async (tx) => {
    // Step 1: move every username out of the way, so step 2 cannot trip the unique
    // constraint (a swapped pair of usernames, or a backup account that took one).
    for (const row of await tx.user.findMany({ select: { id: true, username: true } })) {
      await tx.user.update({
        where: { id: row.id },
        data: keep.has(row.id)
          ? { username: `~restore-${row.id}` }
          : { username: `${row.username}.restored-${row.id}`, isActive: false, tokenVersion: { increment: 1 } },
      });
    }
    // Step 2: this server's accounts, exactly as they were.
    for (const u of before) {
      const { id, recoveryCodes, ...rest } = u;
      const data = { ...rest, recoveryCodes: recoveryCodes === null ? Prisma.DbNull : (recoveryCodes as Prisma.InputJsonValue) };
      await tx.user.upsert({ where: { id }, update: data, create: { id, ...data } });
    }
  });
}
