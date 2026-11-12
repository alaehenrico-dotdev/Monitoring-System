/// Test helper: an in-memory stand-in for the `rate_limit_hits` table, so limiter tests do not
/// need a database. Mimics the one raw statement the store uses (upsert-and-count, decrement).
export const fakeRows = new Map<string, { hits: number; resetAt: Date }>();

function executeRaw(strings: TemplateStringsArray, ...values: unknown[]) {
  const sql = strings.join("?");
  if (sql.includes("INSERT INTO rate_limit_hits")) {
    const key = values[0] as string;
    const newReset = values[1] as Date;
    const now = values[2] as Date;
    const cur = fakeRows.get(key);
    if (!cur || cur.resetAt <= now) fakeRows.set(key, { hits: 1, resetAt: newReset });
    else cur.hits += 1;
  } else if (sql.includes("GREATEST")) {
    const cur = fakeRows.get(values[0] as string);
    if (cur) cur.hits = Math.max(cur.hits - 1, 0);
  }
  return Promise.resolve(1);
}

export const fakePrismaModule = {
  prisma: {
    $executeRaw: executeRaw,
    rateLimitHit: {
      findUnique: async ({ where }: { where: { key: string } }) => {
        const r = fakeRows.get(where.key);
        return r ? { key: where.key, ...r } : null;
      },
      findUniqueOrThrow: async ({ where }: { where: { key: string } }) => ({ key: where.key, ...fakeRows.get(where.key)! }),
      deleteMany: async ({ where }: { where: { key?: string; resetAt?: { lt: Date } } }) => {
        let count = 0;
        for (const [k, v] of fakeRows) {
          if ((where.key && k === where.key) || (where.resetAt && v.resetAt < where.resetAt.lt)) {
            fakeRows.delete(k);
            count++;
          }
        }
        return { count };
      },
    },
  },
};
