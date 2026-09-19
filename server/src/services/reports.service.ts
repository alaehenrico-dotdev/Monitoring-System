import { getOnlineGrid } from "./dailyOnlineStock.service";
import { getOfflineGrid } from "./dailyOfflineStock.service";
import { getTotalStocksGrid } from "./totalStocks.service";
import { toDateOnlyString } from "../utils/date";

/// Merges a date's Morning and Night grids down to one row per product for
/// the Daily Report's printable view (Section 4.8) - the report itself
/// isn't shift-scoped (no shift selector on that page), so each product
/// shows whichever figure is most current for the day: the Night row once
/// a Night entry has actually been saved (the day's closing numbers), the
/// Morning row otherwise.
function mergeShiftGrids<T extends { product: { id: number }; isSaved?: boolean }>(morning: T[], night: T[]): T[] {
  const nightByProduct = new Map(night.map((r) => [r.product.id, r]));
  return morning.map((m) => {
    const n = nightByProduct.get(m.product.id);
    return n?.isSaved ? n : m;
  });
}

/**
 * Section 4.8 - Daily Report: a printable/exportable view of a given date's
 * Online, Offline, and Total grids, laid out the same way as the current
 * Excel printout. This service only composes the read models above - it
 * holds no stock-calculation logic of its own.
 */
export async function getDailyReport(entryDate: Date) {
  const [onlineMorning, onlineNight, offlineMorning, offlineNight, total] = await Promise.all([
    getOnlineGrid(entryDate, "MORNING"),
    getOnlineGrid(entryDate, "NIGHT"),
    getOfflineGrid(entryDate, "MORNING"),
    getOfflineGrid(entryDate, "NIGHT"),
    getTotalStocksGrid(entryDate),
  ]);

  return {
    date: toDateOnlyString(entryDate),
    online: mergeShiftGrids(onlineMorning, onlineNight),
    offline: mergeShiftGrids(offlineMorning, offlineNight),
    total,
  };
}
