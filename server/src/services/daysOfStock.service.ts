import { prisma } from "../lib/prisma";
import { getTotalStocksGrid } from "./totalStocks.service";
import { toNum } from "../utils/stockMath";

/**
 * Dashboard > "Needs restock" / "Lowest days left": how long each product's
 * current stock would last at its recent average rate of leaving the
 * business.
 *
 * WHAT COUNTS AS OUTFLOW
 *
 * Derived from the Remaining Stock formulas (utils/stockMath.ts) rather than
 * picked by name, so the two can't drift:
 *
 *   Online   remaining = onlineStock + productionIn - fulfillmentOut + rts
 *   Offline  remaining = offlineStock + productionIn - deliveryOut
 *                        - upsellOut + backloads
 *
 * Outflow is what those formulas SUBTRACT:
 *   - fulfillmentOut (online)
 *   - deliveryOut + upsellOut (offline)
 *   - minus backloads, which ADDS back: a backload is a delivery route
 *     returning undelivered stock, so a day that sent out 100 and had 30
 *     come back consumed 70, not 100.
 *
 * Deliberately EXCLUDED:
 *   - stockInOffToOl / stockOutOlToOff / stockInOlToOff / stockOutOffToOl.
 *     These are transfers between the Online and Offline pools - one pool's
 *     out is the other's in, so they net to zero across the business and
 *     counting them would make a product that merely got moved around look
 *     like it was being consumed.
 *   - productionIn and rts, which ADD to Remaining Stock. They are inflow and
 *     a return respectively, not consumption.
 *
 * The result is "stock leaving the company", which is the only rate that
 * answers "when do we run out".
 */

/// The window the average is taken over. Fourteen days covers a full
/// fortnightly delivery rhythm, so a product delivered weekly isn't judged by
/// a window that happens to contain two delivery days or none.
const WINDOW_DAYS = 14;

/**
 * Days of actual data required before a rate is reported at all. One or two
 * days is not a rate, it's an anecdote - a single large delivery day would
 * otherwise produce a confident-looking "0.4 days left" on a product with
 * months of stock.
 */
const MIN_DAYS_WITH_DATA = 3;

export interface DaysOfStockRow {
  productId: number;
  name: string;
  sku: string | null;
  unit: string;
  category: string;
  /// Combined online + offline remaining stock, as Total Stocks reports it.
  totalRemainingStock: number;
  /// Null when the SKU has no alert configured.
  lowStockThreshold: number | null;
  /// At or below its configured threshold - the same rule TotalStocksTable
  /// and the dashboard's low-stock card already use, kept here so the client
  /// doesn't re-derive it a third time.
  needsRestock: boolean;
  /// Mean units leaving per day with data in the window. Null when there
  /// isn't enough history to say.
  averageDailyOutflow: number | null;
  /// Null ("n/a" on screen) when there are fewer than MIN_DAYS_WITH_DATA days
  /// of history, or when nothing has gone out - an unmoving product has no
  /// meaningful runout date, and dividing by zero would report Infinity.
  daysLeft: number | null;
  /// How many distinct dates in the window actually had an entry, so the
  /// client can say how solid the figure is.
  daysWithData: number;
}

function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

function windowStart(asOf: Date): Date {
  const start = new Date(asOf);
  start.setUTCDate(start.getUTCDate() - (WINDOW_DAYS - 1));
  return start;
}

/// productId -> { total outflow, distinct dates seen }
type Tally = Map<number, { outflow: number; days: Set<string> }>;

function add(tally: Tally, productId: number, entryDate: Date, outflow: number) {
  const hit = tally.get(productId) ?? { outflow: 0, days: new Set<string>() };
  hit.outflow += outflow;
  // Keyed by calendar date, so Morning and Night of the same day count as one
  // day of data - otherwise a two-shift operation would halve every rate.
  hit.days.add(entryDate.toISOString().slice(0, 10));
  tally.set(productId, hit);
}

/**
 * One aggregated pass per stock table - not one query per product.
 *
 * groupBy (productId, entryDate) collapses the two shifts server-side and
 * returns at most products x 14 rows per table, which is what keeps this a
 * fixed two queries however many SKUs exist. The distinct-day count is why
 * entryDate has to stay in the grouping rather than summing straight to
 * productId: the divisor is "days that had data", not the window length.
 */
async function tallyOutflow(start: Date, end: Date): Promise<Tally> {
  const [online, offline] = await Promise.all([
    prisma.dailyOnlineStock.groupBy({
      by: ["productId", "entryDate"],
      where: { entryDate: { gte: start, lte: end } },
      _sum: { fulfillmentOut: true },
    }),
    prisma.dailyOfflineStock.groupBy({
      by: ["productId", "entryDate"],
      where: { entryDate: { gte: start, lte: end } },
      _sum: { deliveryOut: true, upsellOut: true, backloads: true },
    }),
  ]);

  const tally: Tally = new Map();
  for (const row of online) {
    add(tally, row.productId, row.entryDate, toNum(row._sum.fulfillmentOut));
  }
  for (const row of offline) {
    // Backloads come back INTO stock, so they offset the day's outflow.
    const out =
      toNum(row._sum.deliveryOut) +
      toNum(row._sum.upsellOut) -
      toNum(row._sum.backloads);
    add(tally, row.productId, row.entryDate, out);
  }
  return tally;
}

/**
 * Days of stock left per product, plus the restock flag, as of one date.
 *
 * Sorted most urgent first: products that need restocking lead, then by days
 * left ascending, with "no rate available" last - a product with an unknown
 * runout is not more urgent than one known to have two days left.
 */
export async function getDaysOfStock(asOf: Date): Promise<DaysOfStockRow[]> {
  const [grid, tally] = await Promise.all([
    getTotalStocksGrid(asOf),
    tallyOutflow(windowStart(asOf), asOf),
  ]);

  const rows: DaysOfStockRow[] = grid.map((row) => {
    const hit = tally.get(row.product.id);
    const daysWithData = hit?.days.size ?? 0;
    // A negative total (more came back than went out over the window) is not
    // a consumption rate; treated the same as no movement at all.
    const outflow = Math.max(hit?.outflow ?? 0, 0);

    const averageDailyOutflow =
      daysWithData >= MIN_DAYS_WITH_DATA ? round2(outflow / daysWithData) : null;

    const totalRemainingStock = toNum(row.totalRemainingStock);
    const threshold =
      row.product.lowStockThreshold === null ? null : toNum(row.product.lowStockThreshold);

    return {
      productId: row.product.id,
      name: row.product.name,
      sku: row.product.sku,
      unit: row.product.unit,
      category: row.product.category,
      totalRemainingStock,
      lowStockThreshold: threshold,
      needsRestock: threshold !== null && totalRemainingStock <= threshold,
      averageDailyOutflow,
      daysLeft:
        averageDailyOutflow && averageDailyOutflow > 0
          ? round2(Math.max(totalRemainingStock, 0) / averageDailyOutflow)
          : null,
      daysWithData,
    };
  });

  return rows.sort((a, b) => {
    if (a.needsRestock !== b.needsRestock) return a.needsRestock ? -1 : 1;
    if (a.daysLeft === null) return b.daysLeft === null ? 0 : 1;
    if (b.daysLeft === null) return -1;
    return a.daysLeft - b.daysLeft;
  });
}
