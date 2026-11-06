import { prisma } from "../lib/prisma";
import { offlineDeliveryNet, toNum } from "../utils/stockMath";
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
  /// Offline Delivery Out less Backloads (same-day returns; upsell is not part of it). Null when
  /// no Offline entry exists for the day.
  offlineOut: number | null;
  /// Online RTS and Offline Backloads, shown beside the figures above for information only: RTS is
  /// NOT netted off Online out, and the backloads are already netted into offlineOut. Null when that
  /// side has no entry.
  onlineRts: number | null;
  offlineBackloads: number | null;
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
 * "Out" is the Online Fulfillment Out and the Offline Delivery Out less the
 * day's Backloads (see offlineDeliveryNet). Upsells are not counted here, unlike
 * days-of-stock (offlineNetOutflow). Transfers between the pools are excluded -
 * one pool's out is the other's in, so counting them would inflate the combined
 * figure with stock that never left.
 *
 * Two aggregate queries however many SKUs exist (grouped by date, collapsing
 * products and the Morning/Night shifts server-side). Every date in the range
 * is returned, in order, so the client can draw a gap for a day nobody
 * encoded rather than guess one.
 */
export async function getDailyOutflow(from: Date, to: Date): Promise<DailyOutflowEntry[]> {
  const where = { entryDate: { gte: from, lte: to } };
  const [online, offline] = await Promise.all([
    prisma.dailyOnlineStock.groupBy({ by: ["entryDate"], where, _sum: { fulfillmentOut: true, rts: true } }),
    prisma.dailyOfflineStock.groupBy({
      by: ["entryDate"],
      where,
      _sum: { deliveryOut: true, backloads: true },
    }),
  ]);

  const onlineByDate = new Map(online.map((r) => [toDateOnlyString(r.entryDate), toNum(r._sum.fulfillmentOut)]));
  const rtsByDate = new Map(online.map((r) => [toDateOnlyString(r.entryDate), toNum(r._sum.rts)]));
  const offlineByDate = new Map(
    offline.map((r) => [toDateOnlyString(r.entryDate), offlineDeliveryNet(toNum(r._sum.deliveryOut), toNum(r._sum.backloads))]),
  );
  const backloadsByDate = new Map(offline.map((r) => [toDateOnlyString(r.entryDate), toNum(r._sum.backloads)]));

  const days = Math.round((to.getTime() - from.getTime()) / DAY_MS) + 1;
  return Array.from({ length: days }, (_, i) => {
    const date = toDateOnlyString(new Date(from.getTime() + i * DAY_MS));
    const onlineOut = onlineByDate.has(date) ? round2(onlineByDate.get(date)!) : null;
    const offlineOut = offlineByDate.has(date) ? round2(offlineByDate.get(date)!) : null;
    return {
      date,
      onlineOut,
      offlineOut,
      onlineRts: rtsByDate.has(date) ? round2(rtsByDate.get(date)!) : null,
      offlineBackloads: backloadsByDate.has(date) ? round2(backloadsByDate.get(date)!) : null,
      totalOut: onlineOut === null && offlineOut === null ? null : round2((onlineOut ?? 0) + (offlineOut ?? 0)),
    };
  });
}
