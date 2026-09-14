import { prisma } from "../lib/prisma";
import { PUBLIC_USER_SELECT } from "./userRepository";

export interface ReceiptItemData {
  productId: number;
  quantity: number;
}

export interface ReceiptCreateData {
  orderDate: Date;
  customer: string;
  location: string;
  /// Free text (Section 4.7) - not necessarily a system user.
  salesRepName?: string;
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

// `select: PUBLIC_USER_SELECT` (not a bare `true`) - a bare `true` include
// would pull the full User record into every receipt response, passwordHash
// included, and this endpoint is reachable by any authenticated role, not
// just Supervisor/Admin (Section 3.2).
const WITH_RELATIONS = {
  items: { include: { product: true } },
  salesRep: { select: PUBLIC_USER_SELECT },
  createdBy: { select: PUBLIC_USER_SELECT },
} as const;

/// Section 5.6 / 5.7 - receipts + receipt_items (Sales Order Entry).
export const receiptRepository = {
  create(data: ReceiptCreateData) {
    return prisma.receipt.create({
      data: {
        orderDate: data.orderDate,
        customer: data.customer,
        location: data.location,
        salesRepName: data.salesRepName,
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
