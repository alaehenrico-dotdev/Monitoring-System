import { prisma } from "../lib/prisma";
import { offlineNetOutflow, toNum } from "../utils/stockMath";
import { toDateOnlyString } from "../utils/date";

/// Longest range one request may cover - a year of daily points is already
/// more than a chart can show and keeps the two aggregate queries bounded.
export const MAX_OUTFLOW_DAYS = 366;

export interface DailyOutflowEntry {
  /// "YYYY-MM-DD".
  date: string;
  /// Fulfillment Out, summed over every product and both shifts. Null when
  /// no Online entry exists for the day - "nothing recorded", not "zero".
  onlineOut: number | null;
  /// Offline Delivery Out + Upsell Out - Backloads, same rule. Null when no
  /// Offline entry exists for the day.
  offlineOut: number | null;
  /// Online + Offline out - what left the company that day. Null only when
  /// neither side has an entry.
  totalOut: number | null;
}

const DAY_MS = 86_400_000;

function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

/**
 * Daily Out: stock leaving the company per calendar day, for the Online pool,
 * the Offline pool and both together.
 *
 * "Out" is the same quantity days-of-stock uses (see offlineNetOutflow): the
 * Online Fulfillment Out and the Offline deliveries and upsells less
 * backloads. Transfers between the pools are excluded - one pool's out is the
 * other's in, so counting them would inflate the combined figure with stock
 * that never left.
 *
 * Two aggregate queries however many SKUs exist (grouped by date, collapsing
 * products and the Morning/Night shifts server-side). Every date in the range
 * is returned, in order, so the client can draw a gap for a day nobody
 * encoded rather than guess one.
 */
export async function getDailyOutflow(from: Date, to: Date): Promise<DailyOutflowEntry[]> {
  const where = { entryDate: { gte: from, lte: to } };
  const [online, offline] = await Promise.all([
    prisma.dailyOnlineStock.groupBy({ by: ["entryDate"], where, _sum: { fulfillmentOut: true } }),
    prisma.dailyOfflineStock.groupBy({
      by: ["entryDate"],
      where,
      _sum: { deliveryOut: true, upsellOut: true, backloads: true },
    }),
  ]);

  const onlineByDate = new Map(online.map((r) => [toDateOnlyString(r.entryDate), toNum(r._sum.fulfillmentOut)]));
  const offlineByDate = new Map(
    offline.map((r) => [
      toDateOnlyString(r.entryDate),
      offlineNetOutflow(toNum(r._sum.deliveryOut), toNum(r._sum.upsellOut), toNum(r._sum.backloads)),
    ]),
  );

  const days = Math.round((to.getTime() - from.getTime()) / DAY_MS) + 1;
  return Array.from({ length: days }, (_, i) => {
    const date = toDateOnlyString(new Date(from.getTime() + i * DAY_MS));
    const onlineOut = onlineByDate.has(date) ? round2(onlineByDate.get(date)!) : null;
    const offlineOut = offlineByDate.has(date) ? round2(offlineByDate.get(date)!) : null;
    return {
      date,
      onlineOut,
      offlineOut,
      totalOut: onlineOut === null && offlineOut === null ? null : round2((onlineOut ?? 0) + (offlineOut ?? 0)),
    };
  });
}
