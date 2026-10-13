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
