import { prisma } from "../lib/prisma";

/// Section 5.3 addendum - offline_entry_deliveries: per-destination
/// breakdown of an Offline entry's Delivery (Out). The parent entry's own
/// `deliveryOut` column is kept in sync as a write-through cache (see
/// dailyOfflineStock.service.ts), but these rows are the source of truth.
export const offlineEntryDeliveryRepository = {
  findByEntryId(offlineEntryId: number) {
    return prisma.offlineEntryDelivery.findMany({ where: { offlineEntryId }, select: { destinationId: true, quantity: true } });
  },

  /// Batched form of findByEntryId - same N+1 avoidance as
  /// dailyOfflineStockRepository.getOpeningStocksForProducts.
  async findByEntryIds(offlineEntryIds: number[]): Promise<Map<number, { destinationId: number; quantity: number }[]>> {
    const result = new Map<number, { destinationId: number; quantity: number }[]>();
    if (!offlineEntryIds.length) return result;

    const rows = await prisma.offlineEntryDelivery.findMany({
      where: { offlineEntryId: { in: offlineEntryIds } },
      select: { offlineEntryId: true, destinationId: true, quantity: true },
    });
    for (const row of rows) {
      const bucket = result.get(row.offlineEntryId);
      if (bucket) bucket.push(row);
      else result.set(row.offlineEntryId, [row]);
    }
    return result;
  },

  upsert(offlineEntryId: number, destinationId: number, quantity: number) {
    return prisma.offlineEntryDelivery.upsert({
      where: { offlineEntryId_destinationId: { offlineEntryId, destinationId } },
      create: { offlineEntryId, destinationId, quantity },
      update: { quantity },
    });
  },
};
