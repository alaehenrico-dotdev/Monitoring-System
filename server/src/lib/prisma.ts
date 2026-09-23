import { Prisma, PrismaClient } from "@prisma/client";

// Single shared Prisma client instance for the whole API process.
export const prisma = new PrismaClient();

/// A repository/service function that takes this as its last argument (a
/// `Db`, defaulting to the shared `prisma` singleton) can run either
/// standalone or inside a caller's `prisma.$transaction(async (tx) => ...)`
/// - see receipts.service.ts's createReceiptsBatch for why that matters
/// (the whole batch, and every stock posting it triggers, needs to commit
/// or roll back as one unit).
export type Db = PrismaClient | Prisma.TransactionClient;
