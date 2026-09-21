import { prisma } from "../lib/prisma";
import { getTotalStocksGrid } from "./totalStocks.service";
import { toDateOnlyString } from "../utils/date";

export interface MonthlyOverviewEntry {
  month: number; // 1-12
  /// Online and Offline are separate stock pools (Section 2.1) reported
  /// separately here, same as everywhere else (Total Stocks, Daily
  /// Report) - `totalRemainingStock` is kept alongside them only as an
  /// explicitly-labeled combined figure, never the only number shown.
  onlineRemainingStock: number | null;
  offlineRemainingStock: number | null;
  totalRemainingStock: number | null;
  varianceFlags: number | null;
  receipts: number;
  /// The date the stock/variance snapshot was actually taken from (the last
  /// day within the month that any online/offline entry was saved) - null
  /// when the month has no stock data at all yet.
  snapshotDate: string | null;
}

function monthRange(year: number, month: number) {
  const start = new Date(Date.UTC(year, month - 1, 1));
  const end = new Date(Date.UTC(year, month, 1)); // exclusive - first day of the next month
  return { start, end };
}

async function findLatestStockDateInRange(start: Date, end: Date): Promise<Date | null> {
  const [online, offline] = await Promise.all([
    prisma.dailyOnlineStock.aggregate({ where: { entryDate: { gte: start, lt: end } }, _max: { entryDate: true } }),
    prisma.dailyOfflineStock.aggregate({ where: { entryDate: { gte: start, lt: end } }, _max: { entryDate: true } }),
  ]);
  const dates = [online._max.entryDate, offline._max.entryDate].filter((d): d is Date => d !== null);
  if (!dates.length) return null;
  return dates.reduce((latest, d) => (d > latest ? d : latest));
}

/**
 * Dashboard > Monthly Monitoring (a year-at-a-glance view, on top of the
 * existing dashboard's today-only snapshot). For each calendar month:
 *  - totalRemainingStock / varianceFlags reuse the same month-end-snapshot
 *    approach as the Total Stocks grid (getTotalStocksGrid) - taken from
 *    the last day within that month any online/offline entry was actually
 *    saved, not a true sum-over-the-month (remaining stock doesn't add up
 *    across days the way receipts do). A month with no entries at all comes
 *    back with null rather than a misleading 0.
 *  - receipts is a genuine count of every receipt placed during that month.
 */
export async function getMonthlyOverview(year: number): Promise<MonthlyOverviewEntry[]> {
  const months = Array.from({ length: 12 }, (_, i) => i + 1);

  return Promise.all(
    months.map(async (month): Promise<MonthlyOverviewEntry> => {
      const { start, end } = monthRange(year, month);

      const [snapshotDate, receipts] = await Promise.all([
        findLatestStockDateInRange(start, end),
        prisma.receipt.count({ where: { orderDate: { gte: start, lt: end } } }),
      ]);

      if (!snapshotDate) {
        return {
          month,
          onlineRemainingStock: null,
          offlineRemainingStock: null,
          totalRemainingStock: null,
          varianceFlags: null,
          receipts,
          snapshotDate: null,
        };
      }

      const grid = await getTotalStocksGrid(snapshotDate);
      const onlineRemainingStock = grid.reduce((sum, row) => sum + row.onlineRemainingStock, 0);
      const offlineRemainingStock = grid.reduce((sum, row) => sum + row.offlineRemainingStock, 0);
      const totalRemainingStock = grid.reduce((sum, row) => sum + row.totalRemainingStock, 0);
      const varianceFlags = grid.filter((row) => row.totalVariance !== null && row.totalVariance !== 0).length;

      return {
        month,
        onlineRemainingStock,
        offlineRemainingStock,
        totalRemainingStock,
        varianceFlags,
        receipts,
        snapshotDate: toDateOnlyString(snapshotDate),
      };
    }),
  );
}
