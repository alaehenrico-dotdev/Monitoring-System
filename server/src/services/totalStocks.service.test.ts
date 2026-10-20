import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../repositories/productRepository", () => ({
  productRepository: { findActive: vi.fn() },
}));
vi.mock("../repositories/dailyOnlineStockRepository", () => ({
  dailyOnlineStockRepository: { findAllForDate: vi.fn(), getOpeningStocksForProducts: vi.fn() },
}));
vi.mock("../repositories/dailyOfflineStockRepository", () => ({
  dailyOfflineStockRepository: { findAllForDate: vi.fn(), getOpeningStocksForProducts: vi.fn() },
}));
vi.mock("../repositories/manualCountRepository", () => ({
  manualCountRepository: { findForTotals: vi.fn() },
}));

import { productRepository } from "../repositories/productRepository";
import { dailyOnlineStockRepository } from "../repositories/dailyOnlineStockRepository";
import { dailyOfflineStockRepository } from "../repositories/dailyOfflineStockRepository";
import { manualCountRepository } from "../repositories/manualCountRepository";
import { getTotalStocksGrid } from "./totalStocks.service";

const PRODUCT_ID = 1;
const DATE = new Date("2026-06-15T00:00:00.000Z");

function onlineRow(remainingStock: number) {
  return { productId: PRODUCT_ID, shift: "NIGHT" as const, remainingStock };
}
function offlineRow(remainingStock: number) {
  return { productId: PRODUCT_ID, shift: "NIGHT" as const, remainingStock };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(productRepository.findActive).mockResolvedValue([{ id: PRODUCT_ID, name: "Sweet A" }] as never);
  vi.mocked(manualCountRepository.findForTotals).mockResolvedValue([]);
});

describe("getTotalStocksGrid - a transfer between Online and Offline nets to zero on the Total", () => {
  it("combined remaining stock is unchanged whether or not a transfer has moved stock between the two pools", async () => {
    // Before any transfer: Online has 50, Offline has 30 - total 80.
    vi.mocked(dailyOnlineStockRepository.findAllForDate).mockImplementation(((_date: Date, shift: string) =>
      Promise.resolve(shift === "NIGHT" ? [onlineRow(50)] : [])) as never);
    vi.mocked(dailyOfflineStockRepository.findAllForDate).mockImplementation(((_date: Date, shift: string) =>
      Promise.resolve(shift === "NIGHT" ? [offlineRow(30)] : [])) as never);
    const before = await getTotalStocksGrid(DATE);
    expect(before[0].totalRemainingStock).toBe(80);

    // After a 10-unit transfer FROM Online TO Offline: Online's own
    // remainingStock formula already nets its stockOut, Offline's already
    // nets its mirrored stockIn - a real transfer, not a double-counted one,
    // should leave the combined total exactly where it was.
    vi.mocked(dailyOnlineStockRepository.findAllForDate).mockImplementation(((_date: Date, shift: string) =>
      Promise.resolve(shift === "NIGHT" ? [onlineRow(40)] : [])) as never);
    vi.mocked(dailyOfflineStockRepository.findAllForDate).mockImplementation(((_date: Date, shift: string) =>
      Promise.resolve(shift === "NIGHT" ? [offlineRow(40)] : [])) as never);
    const after = await getTotalStocksGrid(DATE);
    expect(after[0].totalRemainingStock).toBe(80);
    expect(after[0].onlineRemainingStock).toBe(40);
    expect(after[0].offlineRemainingStock).toBe(40);
  });
});

describe("getTotalStocksGrid - totalVariance", () => {
  beforeEach(() => {
    vi.mocked(dailyOnlineStockRepository.findAllForDate).mockImplementation(((_date: Date, shift: string) =>
      Promise.resolve(shift === "NIGHT" ? [onlineRow(50)] : [])) as never);
    vi.mocked(dailyOfflineStockRepository.findAllForDate).mockImplementation(((_date: Date, shift: string) =>
      Promise.resolve(shift === "NIGHT" ? [offlineRow(30)] : [])) as never);
  });

  it("uses the same System Remaining Stock - Manual Count sign convention as Manual Count's own variance", async () => {
    // totalRemainingStock is 80 (see above). A TOTAL-location manual count
    // of 75 (undercounted vs. system) should read as a positive 5, same
    // sign Manual Count's own calculateVariance would give.
    vi.mocked(manualCountRepository.findForTotals).mockResolvedValue([
      { productId: PRODUCT_ID, location: "TOTAL", shift: "NIGHT", manualCount: 75 },
    ] as never);
    const rows = await getTotalStocksGrid(DATE);
    expect(rows[0].totalVariance).toBe(5);
  });

  it("is negative when the physical count is HIGHER than the system total - an overage, not an error", async () => {
    vi.mocked(manualCountRepository.findForTotals).mockResolvedValue([
      { productId: PRODUCT_ID, location: "TOTAL", shift: "NIGHT", manualCount: 90 },
    ] as never);
    const rows = await getTotalStocksGrid(DATE);
    expect(rows[0].totalVariance).toBe(-10);
  });
});

describe("getTotalStocksGrid - an opening balance is not a variance", () => {
  beforeEach(() => {
    vi.mocked(dailyOnlineStockRepository.findAllForDate).mockImplementation(((_d: Date, shift: string) =>
      Promise.resolve(shift === "NIGHT" ? [onlineRow(0)] : [])) as never);
    vi.mocked(dailyOfflineStockRepository.findAllForDate).mockImplementation(((_d: Date, shift: string) =>
      Promise.resolve(shift === "NIGHT" ? [offlineRow(0)] : [])) as never);
  });
  const count = (isOpeningBalance: boolean) =>
    [{ productId: PRODUCT_ID, location: "ONLINE", shift: "NIGHT", manualCount: 120, isOpeningBalance }] as never;

  it("reports 0 variance when the only count behind the figure is an opening balance", async () => {
    vi.mocked(manualCountRepository.findForTotals).mockResolvedValue(count(true));
    const [row] = await getTotalStocksGrid(DATE);
    expect(row.totalManualCount).toBe(120);
    expect(row.totalVariance).toBe(0);
  });

  it("still reports the real variance for an ordinary count", async () => {
    vi.mocked(manualCountRepository.findForTotals).mockResolvedValue(count(false));
    const [row] = await getTotalStocksGrid(DATE);
    expect(row.totalVariance).toBe(-120);
  });
});

describe("getTotalStocksGrid - products nothing was saved for", () => {
  it("shows their carried-forward stock, looked up from the start of the date so an applied count is included", async () => {
    vi.mocked(dailyOnlineStockRepository.findAllForDate).mockResolvedValue([]);
    vi.mocked(dailyOfflineStockRepository.findAllForDate).mockResolvedValue([]);
    vi.mocked(dailyOnlineStockRepository.getOpeningStocksForProducts).mockResolvedValue(new Map([[PRODUCT_ID, 186]]));
    vi.mocked(dailyOfflineStockRepository.getOpeningStocksForProducts).mockResolvedValue(new Map([[PRODUCT_ID, 40]]));

    const [row] = await getTotalStocksGrid(DATE);
    expect(row).toMatchObject({ onlineRemainingStock: 186, offlineRemainingStock: 40, totalRemainingStock: 226 });
    // An applied count only feeds a MORNING shift (never Night), so the lookup
    // must be the morning one - a Night lookup silently skips every counted product.
    expect(dailyOnlineStockRepository.getOpeningStocksForProducts).toHaveBeenCalledWith([PRODUCT_ID], DATE, "MORNING");
    expect(dailyOfflineStockRepository.getOpeningStocksForProducts).toHaveBeenCalledWith([PRODUCT_ID], DATE, "MORNING");
  });
});
