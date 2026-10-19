import type { Shift } from "@prisma/client";
import { prisma } from "../lib/prisma";
import { toNum } from "../utils/stockMath";
import type { EntryLocation } from "./dayLock.service";

export interface NegativeRow {
  productId: number;
  name: string;
  remainingStock: number;
}

/// Products whose Remaining Stock on one page of a date + shift ends below zero.
/// Saves allow this (an Out is often keyed before the In that covers it); it is
/// finishing the day that needs it settled or signed off.
export async function findNegativeRows(entryDate: Date, shift: Shift, location: EntryLocation, take = 50): Promise<NegativeRow[]> {
  const args = {
    where: { entryDate, shift, remainingStock: { lt: 0 } },
    select: { productId: true, remainingStock: true, product: { select: { name: true } } },
    orderBy: { remainingStock: "asc" as const },
    take,
  };
  const rows = location === "ONLINE" ? await prisma.dailyOnlineStock.findMany(args) : await prisma.dailyOfflineStock.findMany(args);
  return rows.map((r) => ({ productId: r.productId, name: r.product.name, remainingStock: toNum(r.remainingStock) }));
}

/// "A (-5), B (-2)" for an error or log line.
export function describeNegatives(rows: NegativeRow[]): string {
  const shown = rows.slice(0, 5).map((r) => `${r.name} (${r.remainingStock})`);
  return shown.join(", ") + (rows.length > 5 ? `, +${rows.length - 5} more` : "");
}
