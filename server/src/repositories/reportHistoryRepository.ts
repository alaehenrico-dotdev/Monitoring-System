import { prisma } from "../lib/prisma";

export interface ReportHistoryCreateData {
  type: string;
  scope: string;
  route: string;
  generatedById?: number | null;
}

/// Server-backed Report History (Daily Report / Variance Report) - see
/// ReportHistoryEntry's own doc comment (schema.prisma).
export const reportHistoryRepository = {
  create(data: ReportHistoryCreateData) {
    return prisma.reportHistoryEntry.create({ data });
  },

  findMany(filters: { type?: string }) {
    return prisma.reportHistoryEntry.findMany({
      where: { type: filters.type },
      include: { generatedBy: { select: { id: true, name: true, username: true } } },
      orderBy: { generatedAt: "desc" },
      take: 200,
    });
  },
};
