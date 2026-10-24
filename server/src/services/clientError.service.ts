import { prisma } from "../lib/prisma";

export interface ClientErrorInput {
  page: string;
  message: string;
  stack?: string;
  source: string;
  appVersion?: string;
  userAgent?: string;
}

const cut = (v: string | undefined, n: number) => (v === undefined ? undefined : v.slice(0, n));

export function recordClientError(input: ClientErrorInput, userId?: number | null) {
  return prisma.clientError.create({
    data: {
      page: input.page.slice(0, 300),
      message: input.message.slice(0, 1000),
      stack: cut(input.stack, 8000),
      source: input.source.slice(0, 32),
      appVersion: cut(input.appVersion, 40),
      userAgent: cut(input.userAgent, 300),
      userId: userId ?? null,
    },
    select: { id: true },
  });
}

export async function listClientErrors({ limit, offset }: { limit: number; offset: number }) {
  const [items, total] = await Promise.all([
    prisma.clientError.findMany({
      include: { user: { select: { id: true, name: true, username: true } } },
      orderBy: { id: "desc" },
      skip: offset,
      take: limit,
    }),
    prisma.clientError.count(),
  ]);
  return { items, total };
}

const DAY_MS = 24 * 60 * 60 * 1000;

/// Keeps the error-report table bounded. The endpoint that fills it takes anonymous
/// input (a crashed login page has no session), rate-limited per IP but not
/// otherwise capped, so without this the table only ever grows. Deletes reports
/// older than `olderThanDays`, then - if still over `maxRows` - the oldest ones
/// beyond the newest `maxRows`. Either limit at 0 is off. Returns how many went.
export async function purgeClientErrors({ olderThanDays, maxRows }: { olderThanDays: number; maxRows: number }, now = Date.now()): Promise<number> {
  let removed = 0;
  if (olderThanDays > 0) {
    const { count } = await prisma.clientError.deleteMany({ where: { createdAt: { lt: new Date(now - olderThanDays * DAY_MS) } } });
    removed += count;
  }
  if (maxRows > 0) {
    // The id of the newest row that falls outside the cap; everything at or below it goes.
    const boundary = await prisma.clientError.findFirst({ orderBy: { id: "desc" }, skip: maxRows, select: { id: true } });
    if (boundary) {
      const { count } = await prisma.clientError.deleteMany({ where: { id: { lte: boundary.id } } });
      removed += count;
    }
  }
  return removed;
}
