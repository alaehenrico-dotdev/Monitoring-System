import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getDailyReport: vi.fn(),
  getDailyOutflow: vi.fn(),
  prisma: { dailyOnlineStock: { aggregate: vi.fn() }, dailyOfflineStock: { aggregate: vi.fn() } },
}));
vi.mock("./reports.service", () => ({ getDailyReport: mocks.getDailyReport }));
vi.mock("./dailyOutflow.service", () => ({ getDailyOutflow: mocks.getDailyOutflow }));
vi.mock("../lib/prisma", () => ({ prisma: mocks.prisma }));

import { buildDailyReportPdf, dailyReportFileName, dailyReportSheets, latestEntryDate } from "./dailyReportPdf.service";

const product = { category: "Class A", sku: "A1", name: "Alpha" };
const d = (s: string) => new Date(`${s}T00:00:00Z`);

const report = {
  online: [{ product, isSaved: true, entry: { openingStock: 10, onlineStock: 10, productionIn: 5, fulfillmentOut: 3, rts: 1, remainingStock: 13 } }],
  offline: [{ product: { ...product, sku: null }, isSaved: false, entry: { openingStock: 4, offlineStock: 4, deliveryOut: 2, upsellOut: 1, backloads: 0.5, remainingStock: 1.5 } }],
  total: [{ product, onlineRemainingStock: 13, offlineRemainingStock: 1.5, totalRemainingStock: 14.5, totalManualCount: null, totalVariance: null }],
};

beforeEach(() => vi.clearAllMocks());

describe("dailyReportSheets", () => {
  it("lays out Online, Offline, Consolidated and Daily Out with the entry-page column names", () => {
    const sheets = dailyReportSheets(report, { onlineOut: 3, offlineOut: 2.5, totalOut: 5.5 });
    expect(sheets.map((s) => s.name)).toEqual(["Summary", "Online", "Offline", "Consolidated", "Daily Out", "Audit"]);
    expect(sheets[1].columns).toEqual(["Category", "SKU", "Product", "Stocks (Opening)", "Stocks In (Off→Ol)", "Stocks Out (Ol→Off)", "Online Stocks", "Production (In)", "Fulfillment (Out)", "RTS", "Remaining Stocks"]);
    expect(sheets[1].rows[0]).toEqual(["Class A", "A1", "Alpha", 10, 0, 0, 10, 5, 3, 1, 13]);
    expect(sheets[2].rows[0]).toEqual(["Class A", "", "Alpha", 4, 0, 0, 4, 0, 2, 0.5, 1, 1.5]);
    expect(sheets[3].rows[0]).toEqual(["Class A", "A1", "Alpha", 13, 1.5, 14.5, null, null]);
    expect(sheets[4].rows).toEqual([[3, 2.5, 5.5]]);
  });

  it("keeps the Daily Out sheet empty when there are no figures, rather than inventing zeros", () => {
    expect(dailyReportSheets(report, null)[4].rows).toEqual([]);
  });
});

describe("Summary and Audit sheets", () => {
  const audit = [
    { product, shift: "NIGHT", location: "ONLINE", systemRemainingStock: 13, manualCount: 12, variance: 1, remarks: "Spillage", published: true, isOpeningBalance: false },
    { product, shift: "MORNING", location: "OFFLINE", systemRemainingStock: 2, manualCount: 2, variance: 0, remarks: null, published: false, isOpeningBalance: false },
    { product, shift: "NIGHT", location: "TOTAL", systemRemainingStock: 5, manualCount: 5, variance: 0, remarks: null, published: false, isOpeningBalance: true },
  ];

  it("lists every count with the system figure, the count, the gap, remarks and status", () => {
    const sheets = dailyReportSheets({ ...report, audit }, null);
    const sheet = sheets.find((s) => s.name === "Audit")!;
    expect(sheet.columns).toEqual(["Category", "SKU", "Product", "Shift", "Location", "System Remaining", "Counted", "Variance", "Remarks", "Status"]);
    expect(sheet.rows).toEqual([
      ["Class A", "A1", "Alpha", "Night", "Online", 13, 12, 1, "Spillage", "Published"],
      ["Class A", "A1", "Alpha", "Morning", "Offline", 2, 2, 0, "", "Not published"],
      ["Class A", "A1", "Alpha", "Night", "Total", 5, 5, 0, "", "Opening balance"],
    ]);
  });

  it("keeps an empty Audit sheet for a day with no counts, and for an older frozen report with none stored", () => {
    expect(dailyReportSheets(report, null).find((s) => s.name === "Audit")!.rows).toEqual([]);
    expect(dailyReportSheets({ ...report, audit: [] }, null).find((s) => s.name === "Audit")!.rows).toEqual([]);
  });

  it("says on the Summary whether the day is live or finished", () => {
    const live = dailyReportSheets({ ...report, date: "2026-10-22", audit, snapshot: null }, null)[0];
    expect(live.rows[0]).toEqual(["Report date", "2026-10-22"]);
    expect(String(live.rows[1][1])).toMatch(/^Live/);
    expect(live.rows.find((r) => r[0] === "Audit counts")).toEqual(["Audit counts", 3]);

    const done = dailyReportSheets({ ...report, date: "2026-10-22", snapshot: { savedAt: "2026-10-22T14:00:00.000Z", savedBy: { name: "Ana" } } }, null)[0];
    expect(String(done.rows[1][1])).toMatch(/^Finished/);
    expect(done.rows).toContainEqual(["Saved by", "Ana"]);
  });

  it("builds the same bytes every time for the same report - nothing in it depends on when it was made", async () => {
    mocks.getDailyReport.mockResolvedValue({ ...report, date: "2026-10-22", audit, snapshot: null });
    mocks.getDailyOutflow.mockResolvedValue([{ date: "2026-10-22", onlineOut: 3, offlineOut: 2.5, totalOut: 5.5 }]);
    const a = await buildDailyReportPdf(d("2026-10-22"));
    await new Promise((r) => setTimeout(r, 1100)); // past a whole second, which the old zip time would have noticed
    const b = await buildDailyReportPdf(d("2026-10-22"));
    expect(a!.data.equals(b!.data)).toBe(true);
  });
});

describe("buildDailyReportPdf", () => {
  it("builds a named PDF for a day with saved entries", async () => {
    mocks.getDailyReport.mockResolvedValue(report);
    mocks.getDailyOutflow.mockResolvedValue([{ date: "2026-10-22", onlineOut: 3, offlineOut: 2.5, totalOut: 5.5 }]);
    const out = await buildDailyReportPdf(d("2026-10-22"));
    expect(out?.fileName).toBe("daily-report-2026-10-22.pdf");
    expect(out?.data.subarray(0, 5).toString()).toBe("%PDF-");
  });

  it("builds nothing for a day with no saved entry", async () => {
    mocks.getDailyReport.mockResolvedValue({ ...report, online: [{ ...report.online[0], isSaved: false }], offline: [] });
    expect(await buildDailyReportPdf(d("2026-10-22"))).toBeNull();
    expect(mocks.getDailyOutflow).not.toHaveBeenCalled();
  });
});

describe("latestEntryDate / dailyReportFileName", () => {
  it("is the later of the two tables' newest dates, or null", async () => {
    mocks.prisma.dailyOnlineStock.aggregate.mockResolvedValue({ _max: { entryDate: d("2026-10-19") } });
    mocks.prisma.dailyOfflineStock.aggregate.mockResolvedValue({ _max: { entryDate: d("2026-10-21") } });
    expect(await latestEntryDate()).toEqual(d("2026-10-21"));
    mocks.prisma.dailyOnlineStock.aggregate.mockResolvedValue({ _max: { entryDate: null } });
    mocks.prisma.dailyOfflineStock.aggregate.mockResolvedValue({ _max: { entryDate: null } });
    expect(await latestEntryDate()).toBeNull();
  });

  it("names the file by date", () => {
    expect(dailyReportFileName("2026-10-22")).toBe("daily-report-2026-10-22.pdf");
  });
});
