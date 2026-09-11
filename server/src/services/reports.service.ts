import { getOnlineGrid } from "./dailyOnlineStock.service";
import { getOfflineGrid } from "./dailyOfflineStock.service";
import { getTotalStocksGrid } from "./totalStocks.service";
import { toDateOnlyString } from "../utils/date";

/**
 * Section 4.8 - Daily Report: a printable/exportable view of a given date's
 * Online, Offline, and Total grids, laid out the same way as the current
 * Excel printout. This service only composes the three read models above -
 * it holds no stock-calculation logic of its own.
 */
export async function getDailyReport(entryDate: Date) {
  const [online, offline, total] = await Promise.all([
    getOnlineGrid(entryDate),
    getOfflineGrid(entryDate),
    getTotalStocksGrid(entryDate),
  ]);

  return { date: toDateOnlyString(entryDate), online, offline, total };
}
