import { prisma } from "../lib/prisma";
import { toNum } from "../utils/stockMath";
import { toDateOnlyString } from "../utils/date";

/// Longest range one request may cover - same bound as Daily Out.
export const MAX_FLOW_DAYS = 366;

export interface StockFlowEntry {
  /// "YYYY-MM-DD".
  date: string;
  /// Production In, Online + Offline. Null when neither pool has an entry.
  production: number | null;
  /// Online Fulfillment Out. Null when no Online entry exists for the day.
  fulfillment: number | null;
  /// Offline Delivery Out (gross - backloads are not netted here, this is what
  /// went on the trucks). Null when no Offline entry exists for the day.
  delivery: number | null;
}

const DAY_MS = 86_400_000;

function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

/**
 * Stock flow per calendar day: what was produced, what Online fulfilled and
 * what Offline delivered. Two aggregate queries however many SKUs exist, both
 * shifts and every product collapsed server-side. Every date in the range is
 * returned, in order, so a day nobody encoded is a gap, never a guessed zero.
 */
export async function getStockFlow(from: Date, to: Date): Promise<StockFlowEntry[]> {
  const where = { entryDate: { gte: from, lte: to } };
  const [online, offline] = await Promise.all([
    prisma.dailyOnlineStock.groupBy({ by: ["entryDate"], where, _sum: { productionIn: true, fulfillmentOut: true } }),
    prisma.dailyOfflineStock.groupBy({ by: ["entryDate"], where, _sum: { productionIn: true, deliveryOut: true } }),
  ]);
  const on = new Map(online.map((r) => [toDateOnlyString(r.entryDate), r._sum]));
  const off = new Map(offline.map((r) => [toDateOnlyString(r.entryDate), r._sum]));

  const days = Math.round((to.getTime() - from.getTime()) / DAY_MS) + 1;
  return Array.from({ length: days }, (_, i) => {
    const date = toDateOnlyString(new Date(from.getTime() + i * DAY_MS));
    const o = on.get(date);
    const f = off.get(date);
    return {
      date,
      production: o || f ? round2(toNum(o?.productionIn) + toNum(f?.productionIn)) : null,
      fulfillment: o ? round2(toNum(o.fulfillmentOut)) : null,
      delivery: f ? round2(toNum(f.deliveryOut)) : null,
    };
  });
}
