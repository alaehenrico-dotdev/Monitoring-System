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

  /// One page, newest first, by id (append-only, so id order is time order and
  /// the cursor stays stable while new rows arrive). One extra row tells the
  /// caller whether another page exists.
  findPage(filters: { type?: string }, { limit, cursor }: { limit: number; cursor?: number }) {
    return prisma.reportHistoryEntry.findMany({
      where: { type: filters.type, ...(cursor ? { id: { lt: cursor } } : {}) },
      include: { generatedBy: { select: { id: true, name: true, username: true } } },
      orderBy: { id: "desc" },
      take: limit + 1,
    });
  },
};
