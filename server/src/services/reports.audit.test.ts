import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  findAllForDateWithProduct: vi.fn(),
  findFrozenSnapshot: vi.fn(),
  getOnlineGrid: vi.fn(async () => []),
  getOfflineGrid: vi.fn(async () => []),
  getTotalStocksGrid: vi.fn(async () => []),
}));
vi.mock("../repositories/manualCountRepository", () => ({ manualCountRepository: { findAllForDateWithProduct: mocks.findAllForDateWithProduct } }));
vi.mock("./dailyOnlineStock.service", () => ({ getOnlineGrid: mocks.getOnlineGrid }));
vi.mock("./dailyOfflineStock.service", () => ({ getOfflineGrid: mocks.getOfflineGrid }));
vi.mock("./totalStocks.service", () => ({ getTotalStocksGrid: mocks.getTotalStocksGrid }));
vi.mock("./dailyReportSnapshot.service", () => ({
  findFrozenSnapshot: mocks.findFrozenSnapshot,
  snapshotMeta: (s: { savedAt: Date }) => ({ savedAt: s.savedAt.toISOString(), savedBy: null }),
}));

import { buildAudit, buildDailyReport, getDailyReport } from "./reports.service";

const DAY = new Date("2026-10-22T00:00:00Z");
const count = (over = {}) => ({
  product: { category: "Class A", sku: "A1", name: "Alpha", sortOrder: 1 },
  shift: "NIGHT",
  location: "ONLINE",
  systemRemainingStock: "13.00", // Prisma hands decimals back as strings
  manualCount: "12.00",
  variance: "1.00",
  remarks: null,
  publishedAt: new Date("2026-10-22T20:00:00Z"),
  isOpeningBalance: false,
  ...over,
});

beforeEach(() => {
  vi.clearAllMocks();
  mocks.findFrozenSnapshot.mockResolvedValue(null);
  mocks.findAllForDateWithProduct.mockResolvedValue([]);
});

describe("buildAudit", () => {
  it("turns each count into plain numbers and strings, so it survives being frozen as JSON", async () => {
    mocks.findAllForDateWithProduct.mockResolvedValue([count(), count({ shift: "MORNING", location: "OFFLINE", publishedAt: null, remarks: "Recount", isOpeningBalance: true })]);
    const rows = await buildAudit(DAY);
    expect(rows[0]).toEqual({
      product: { category: "Class A", sku: "A1", name: "Alpha" },
      shift: "NIGHT",
      location: "ONLINE",
      systemRemainingStock: 13,
      manualCount: 12,
      variance: 1,
      remarks: null,
      published: true,
      isOpeningBalance: false,
    });
    expect(rows[1]).toMatchObject({ shift: "MORNING", location: "OFFLINE", published: false, remarks: "Recount", isOpeningBalance: true });
    expect(JSON.parse(JSON.stringify(rows))).toEqual(rows);
  });

  it("is empty for a date nobody counted", async () => {
    expect(await buildAudit(DAY)).toEqual([]);
  });
});

describe("buildDailyReport covers the whole day", () => {
  it("asks both grids for the day's Night view with the two sheets combined, whatever the shifts setting", async () => {
    await buildDailyReport(DAY);
    expect(mocks.getOnlineGrid).toHaveBeenCalledTimes(1);
    expect(mocks.getOnlineGrid).toHaveBeenCalledWith(DAY, "NIGHT", { combineSplitDay: "always" });
    expect(mocks.getOfflineGrid).toHaveBeenCalledTimes(1);
    expect(mocks.getOfflineGrid).toHaveBeenCalledWith(DAY, "NIGHT", { combineSplitDay: "always" });
  });

  it("passes the grids' rows straight through - one row per product, nothing picked or dropped", async () => {
    const online = [{ product: { id: 1 }, isSaved: true, entry: { fulfillmentOut: 5, fulfillmentOut__x1: 3, fulfillmentOut__x2: 2 } }];
    const offline = [{ product: { id: 1 }, isSaved: true, entry: { deliveryOut: 55, deliveryOut__x1: 15, deliveryOut__x2: 40 } }];
    mocks.getOnlineGrid.mockResolvedValue(online as never);
    mocks.getOfflineGrid.mockResolvedValue(offline as never);
    const report = await buildDailyReport(DAY);
    expect(report.online).toBe(online);
    expect(report.offline).toBe(offline);
    expect(report.date).toBe("2026-10-22");
  });
});

describe("the report carries the audit", () => {
  it("a live report reads the day's counts", async () => {
    mocks.findAllForDateWithProduct.mockResolvedValue([count()]);
    const report = await buildDailyReport(DAY);
    expect(report.audit).toHaveLength(1);
    expect((await getDailyReport(DAY)).snapshot).toBeNull();
  });

  it("a frozen report keeps the audit it was saved with, whatever the counts say now", async () => {
    const stored = [{ product: { category: "C", sku: null, name: "Frozen" }, shift: "NIGHT", location: "ONLINE", systemRemainingStock: 1, manualCount: 1, variance: 0, remarks: null, published: true, isOpeningBalance: false }];
    mocks.findFrozenSnapshot.mockResolvedValue({ payload: { date: "2026-10-22", online: [], offline: [], total: [], audit: stored }, savedAt: new Date("2026-10-22T14:00:00Z") });
    mocks.findAllForDateWithProduct.mockResolvedValue([count()]); // a count changed after the day was frozen
    const report = await getDailyReport(DAY);
    expect(report.audit).toEqual(stored);
    expect(mocks.findAllForDateWithProduct).not.toHaveBeenCalled();
  });

  it("a report frozen before the audit existed gets the day's counts read live, never an empty section", async () => {
    mocks.findFrozenSnapshot.mockResolvedValue({ payload: { date: "2026-10-22", online: [], offline: [], total: [] }, savedAt: new Date("2026-10-22T14:00:00Z") });
    mocks.findAllForDateWithProduct.mockResolvedValue([count()]);
    const report = await getDailyReport(DAY);
    expect(report.audit).toHaveLength(1);
    expect(report.snapshot).not.toBeNull();
  });
});
