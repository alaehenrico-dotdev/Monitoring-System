import { prisma } from "../lib/prisma";

export interface ReceiptItemData {
  productId: number;
  quantity: number;
}

export interface ReceiptCreateData {
  orderDate: Date;
  customer: string;
  location: string;
  salesRepId?: number;
  createdById?: number;
  items: ReceiptItemData[];
}

export interface ReceiptListFilters {
  date?: Date;
  customer?: string;
  location?: string;
  salesRepId?: number;
}

const WITH_RELATIONS = { items: { include: { product: true } }, salesRep: true, createdBy: true } as const;

/// Section 5.6 / 5.7 - receipts + receipt_items (Sales Order Entry).
export const receiptRepository = {
  create(data: ReceiptCreateData) {
    return prisma.receipt.create({
      data: {
        orderDate: data.orderDate,
        customer: data.customer,
        location: data.location,
        salesRepId: data.salesRepId,
        createdById: data.createdById,
        items: { create: data.items },
      },
      include: WITH_RELATIONS,
    });
  },

  findMany(filters: ReceiptListFilters) {
    return prisma.receipt.findMany({
      where: {
        orderDate: filters.date,
        customer: filters.customer ? { contains: filters.customer } : undefined,
        location: filters.location ? { contains: filters.location } : undefined,
        salesRepId: filters.salesRepId,
      },
      include: WITH_RELATIONS,
      orderBy: { createdAt: "desc" },
      take: 200,
    });
  },

  findById(id: number) {
    return prisma.receipt.findUnique({ where: { id }, include: WITH_RELATIONS });
  },
};
