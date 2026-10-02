import { prisma } from "../lib/prisma";

export interface SystemLogCreateData {
  event: string;
  fromVersion: string;
  toVersion: string;
  userId?: number | null;
}

/// System Log (app version/release events) - see SystemLogEntry's own doc
/// comment (schema.prisma).
export const systemLogRepository = {
  create(data: SystemLogCreateData) {
    return prisma.systemLogEntry.create({ data });
  },

  findMany() {
    return prisma.systemLogEntry.findMany({
      include: { user: { select: { id: true, name: true, username: true } } },
      orderBy: { occurredAt: "desc" },
      take: 200,
    });
  },
};
