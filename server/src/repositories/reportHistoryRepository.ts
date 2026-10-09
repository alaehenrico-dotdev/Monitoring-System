import { prisma, type Db } from "../lib/prisma";

export interface ReportHistoryCreateData {
  type: string;
  scope: string;
  route: string;
  section?: string | null;
  generatedById?: number | null;
}

/// Server-backed Report History (Daily Report / Variance Report) - see
/// ReportHistoryEntry's own doc comment (schema.prisma).
export const reportHistoryRepository = {
  create(data: ReportHistoryCreateData, db: Db = prisma) {
    return db.reportHistoryEntry.create({ data });
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
