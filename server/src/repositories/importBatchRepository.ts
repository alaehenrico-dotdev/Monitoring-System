import { Shift, StockLocation } from "@prisma/client";
import { prisma } from "../lib/prisma";

export interface ImportBatchCreateData {
  location: StockLocation;
  entryDate: Date;
  shift: Shift;
  fileName: string;
  importedById?: number | null;
}

/// Import History (Section: CSV import into Manual Count) - see
/// importBatch.service.ts for the revert logic this backs.
export const importBatchRepository = {
  create(data: ImportBatchCreateData) {
    return prisma.importBatch.create({ data });
  },

  updateRowCount(id: number, rowCount: number) {
    return prisma.importBatch.update({ where: { id }, data: { rowCount } });
  },

  findById(id: number) {
    return prisma.importBatch.findUnique({ where: { id } });
  },

  findMany(filters: { location?: StockLocation }) {
    return prisma.importBatch.findMany({
      where: { location: filters.location },
      include: { importedBy: { select: { id: true, name: true, username: true } } },
      orderBy: { importedAt: "desc" },
      take: 200,
    });
  },

  delete(id: number) {
    return prisma.importBatch.delete({ where: { id } });
  },
};
