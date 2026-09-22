import { prisma } from "../lib/prisma";

export interface DeliveryDestinationCreateData {
  name: string;
}

export interface DeliveryDestinationUpdateData {
  name?: string;
  isActive?: boolean;
  sortOrder?: number;
}

const SELECT = { id: true, name: true, isActive: true, sortOrder: true } as const;
const ORDER_BY = [{ sortOrder: "asc" }, { name: "asc" }] as const;

/// Section 5.11 - delivery_destinations: the per-destination breakdown
/// picker for Offline entries' Delivery (Out).
export const deliveryDestinationRepository = {
  findAll(includeInactive: boolean) {
    return prisma.deliveryDestination.findMany({
      where: includeInactive ? undefined : { isActive: true },
      orderBy: [...ORDER_BY],
      select: SELECT,
    });
  },

  findById(id: number) {
    return prisma.deliveryDestination.findUnique({ where: { id } });
  },

  findByIds(ids: number[]) {
    if (!ids.length) return Promise.resolve([]);
    return prisma.deliveryDestination.findMany({ where: { id: { in: ids } } });
  },

  findByName(name: string) {
    return prisma.deliveryDestination.findFirst({ where: { name } });
  },

  create(data: DeliveryDestinationCreateData) {
    return prisma.deliveryDestination.create({ data, select: SELECT });
  },

  update(id: number, data: DeliveryDestinationUpdateData) {
    return prisma.deliveryDestination.update({ where: { id }, data, select: SELECT });
  },
};
