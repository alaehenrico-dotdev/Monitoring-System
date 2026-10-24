import { prisma } from "../lib/prisma";
import { offlineNetOutflow, toNum } from "../utils/stockMath";

/// Longest window one request may cover (a year, like Daily Out).
export const MAX_PERIOD_DAYS = 366;

export interface PeriodProductRow {
  productId: number;
  sku: string | null;
  name: string;
  category: string;
  unit: string;
  onlineOut: number;
  /// Deliveries + upsells less backloads (see offlineNetOutflow).
  offlineOut: number;
  totalOut: number;
  backloads: number;
  rts: number;
  /// Online + Offline production in.
  productionIn: number;
  /// Sum of (counted - system) over the period's audit counts: gains and
  /// losses cancel.
  netVariance: number;
  /// Sum of |counted - system|: the total size of the discrepancies.
  absVariance: number;
}

export interface PeriodTotals {
  onlineOut: number;
  offlineOut: number;
  totalOut: number;
  backloads: number;
  rts: number;
  productionIn: number;
  netVariance: number;
  absVariance: number;
  /// Products with at least one non-zero variance in the period.
  flaggedProducts: number;
  /// Distinct dates with at least one audit count. Variance only exists on
  /// these days, so the page says how many there were.
  countedDays: number;
}

export interface PeriodMonitoring {
  from: string;
  to: string;
  days: number;
  totals: PeriodTotals;
  products: PeriodProductRow[];
}

function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

interface OnlineSum {
  productId: number;
  _sum: { fulfillmentOut: unknown; rts: unknown; productionIn: unknown };
}
interface OfflineSum {
  productId: number;
  _sum: { deliveryOut: unknown; upsellOut: unknown; backloads: unknown; productionIn: unknown };
}
interface CountLine {
  productId: number;
  entryDate: Date;
  variance: unknown;
}
interface ProductInfo {
  id: number;
  sku: string | null;
  name: string;
  category: string;
  unit: string;
  sortOrder: number;
}

/// Pure assembly, split out so the arithmetic is testable without a database.
export function buildPeriodMonitoring(
  range: { from: string; to: string; days: number },
  online: OnlineSum[],
  offline: OfflineSum[],
  counts: CountLine[],
  products: ProductInfo[],
): PeriodMonitoring {
  const byId = new Map<number, PeriodProductRow>();
  const info = new Map(products.map((p) => [p.id, p]));
  const row = (productId: number): PeriodProductRow => {
    let r = byId.get(productId);
    if (!r) {
      const p = info.get(productId);
      r = {
        productId,
        sku: p?.sku ?? null,
        name: p?.name ?? `Product ${productId}`,
        category: p?.category ?? "",
        unit: p?.unit ?? "",
        onlineOut: 0,
        offlineOut: 0,
        totalOut: 0,
        backloads: 0,
        rts: 0,
        productionIn: 0,
        netVariance: 0,
        absVariance: 0,
      };
      byId.set(productId, r);
    }
    return r;
  };

  for (const o of online) {
    const r = row(o.productId);
    r.onlineOut += toNum(o._sum.fulfillmentOut);
    r.rts += toNum(o._sum.rts);
    r.productionIn += toNum(o._sum.productionIn);
  }
  for (const o of offline) {
    const r = row(o.productId);
    r.offlineOut += offlineNetOutflow(toNum(o._sum.deliveryOut), toNum(o._sum.upsellOut), toNum(o._sum.backloads));
    r.backloads += toNum(o._sum.backloads);
    r.productionIn += toNum(o._sum.productionIn);
  }
  const countedDates = new Set<string>();
  for (const c of counts) {
    const v = toNum(c.variance);
    const r = row(c.productId);
    r.netVariance += v;
    r.absVariance += Math.abs(v);
    countedDates.add(c.entryDate.toISOString().slice(0, 10));
  }

  const rows = [...byId.values()].map((r) => ({
    ...r,
    onlineOut: round2(r.onlineOut),
    offlineOut: round2(r.offlineOut),
    totalOut: round2(r.onlineOut + r.offlineOut),
    backloads: round2(r.backloads),
    rts: round2(r.rts),
    productionIn: round2(r.productionIn),
    netVariance: round2(r.netVariance),
    absVariance: round2(r.absVariance),
  }));
  rows.sort(
    (a, b) =>
      a.category.localeCompare(b.category) ||
      (info.get(a.productId)?.sortOrder ?? 0) - (info.get(b.productId)?.sortOrder ?? 0) ||
      a.name.localeCompare(b.name),
  );

  const sum = (pick: (r: PeriodProductRow) => number) => round2(rows.reduce((acc, r) => acc + pick(r), 0));
  return {
    ...range,
    totals: {
      onlineOut: sum((r) => r.onlineOut),
      offlineOut: sum((r) => r.offlineOut),
      totalOut: sum((r) => r.totalOut),
      backloads: sum((r) => r.backloads),
      rts: sum((r) => r.rts),
      productionIn: sum((r) => r.productionIn),
      netVariance: sum((r) => r.netVariance),
      absVariance: sum((r) => r.absVariance),
      flaggedProducts: rows.filter((r) => r.absVariance > 0).length,
      countedDays: countedDates.size,
    },
    products: rows,
  };
}

/**
 * Weekly / Monthly Monitoring: flow totals (out, backloads, RTS, production)
 * and audit variance over any window of days, per product and in total. The
 * flows are summed from the daily Online/Offline entries (both shifts); the
 * variance comes from manual counts, so it covers only the days someone
 * counted. Opening-balance counts seed the system and are not audit results,
 * so they are left out, exactly as in the Variance Report, and so are TOTAL counts. Three grouped
 * queries plus one product lookup, however many SKUs exist.
 */
export async function getPeriodMonitoring(from: Date, to: Date): Promise<PeriodMonitoring> {
  const entryDate = { gte: from, lte: to };
  const [online, offline, counts] = await Promise.all([
    prisma.dailyOnlineStock.groupBy({
      by: ["productId"],
      where: { entryDate },
      _sum: { fulfillmentOut: true, rts: true, productionIn: true },
    }),
    prisma.dailyOfflineStock.groupBy({
      by: ["productId"],
      where: { entryDate },
      _sum: { deliveryOut: true, upsellOut: true, backloads: true, productionIn: true },
    }),
    prisma.manualCount.findMany({
      // Online and Offline counts only: a TOTAL count is the same stock again,
      // informational, and would count every discrepancy twice.
      where: { entryDate, isOpeningBalance: false, location: { in: ["ONLINE", "OFFLINE"] } },
      select: { productId: true, entryDate: true, variance: true },
    }),
  ]);
  const ids = [...new Set([...online, ...offline, ...counts].map((r) => r.productId))];
  const products = ids.length
    ? await prisma.product.findMany({
        where: { id: { in: ids } },
        select: { id: true, sku: true, name: true, category: true, unit: true, sortOrder: true },
      })
    : [];
  const days = Math.round((to.getTime() - from.getTime()) / 86_400_000) + 1;
  return buildPeriodMonitoring(
    { from: from.toISOString().slice(0, 10), to: to.toISOString().slice(0, 10), days },
    online,
    offline,
    counts,
    products,
  );
}
