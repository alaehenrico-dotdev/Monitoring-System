import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getDailyReport: vi.fn(),
  getDailyOutflow: vi.fn(),
  // A plain function, not a spy: vitest tracks a spy's rejected promise without
  // handling it, which would report an "unhandled rejection" for a failure the
  // code under test does handle.
  names: { impl: (async () => ({ ONLINE: {}, OFFLINE: {} })) as (date: Date) => Promise<unknown>, calls: [] as Date[] },
  prisma: { dailyOnlineStock: { aggregate: vi.fn() }, dailyOfflineStock: { aggregate: vi.fn() } },
}));
vi.mock("./extraColumnLabels.service", () => ({
  getDayExtraNames: (date: Date) => {
    mocks.names.calls.push(date);
    return mocks.names.impl(date);
  },
}));
vi.mock("./reports.service", () => ({ getDailyReport: mocks.getDailyReport }));
vi.mock("./dailyOutflow.service", () => ({ getDailyOutflow: mocks.getDailyOutflow }));
vi.mock("../lib/prisma", () => ({ prisma: mocks.prisma }));

import { buildDailyReportPdf, columnsWithExtras, dailyReportFileName, dailyReportSheets, latestEntryDate } from "./dailyReportPdf.service";

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

describe("added columns on the Online and Offline sheets", () => {
  beforeEach(() => {
    mocks.names.impl = async () => ({ ONLINE: {}, OFFLINE: {} });
    mocks.names.calls = [];
  });
  // Rows carry an added column's amount as "<column>__x<slot>", beside the main column's total.
  const withExtras = {
    ...report,
    online: [{ product, isSaved: true, entry: { openingStock: 10, onlineStock: 10, productionIn: 5, fulfillmentOut: 5, fulfillmentOut__x1: 3, fulfillmentOut__x2: 2, rts: 1, remainingStock: 11 } }],
    offline: [{ product, isSaved: true, entry: { openingStock: 4, offlineStock: 4, deliveryOut: 6, deliveryOut__x1: 4, deliveryOut__x2: 2, remainingStock: 1 } }],
  };
  const sheet = (sheets: ReturnType<typeof dailyReportSheets>, name: string) => sheets.find((s) => s.name === name)!;

  it("puts each added column right after the column it was added to, with its amount", () => {
    const online = sheet(dailyReportSheets(withExtras, null), "Online");
    expect(online.columns).toEqual([
      "Category", "SKU", "Product", "Stocks (Opening)", "Stocks In (Off→Ol)", "Stocks Out (Ol→Off)", "Online Stocks", "Production (In)",
      "Fulfillment (Out)", "Fulfillment (Out) +1", "Fulfillment (Out) +2", "RTS", "Remaining Stocks",
    ]);
    expect(online.rows[0]).toEqual(["Class A", "A1", "Alpha", 10, 0, 0, 10, 5, 5, 3, 2, 1, 11]);
    const offline = sheet(dailyReportSheets(withExtras, null), "Offline");
    expect(offline.columns).toContain("Delivery (Out) +1");
    expect(offline.columns.indexOf("Delivery (Out) +1")).toBe(offline.columns.indexOf("Delivery (Out)") + 1);
  });

  it("uses the names typed for the day's added columns, falling back to +N for an unnamed one", () => {
    const names = { ONLINE: { fulfillmentOut__x1: "Shopee" }, OFFLINE: { deliveryOut__x2: "Route B / Route C" } };
    const sheets = dailyReportSheets(withExtras, null, names);
    expect(sheet(sheets, "Online").columns).toEqual(expect.arrayContaining(["Shopee", "Fulfillment (Out) +2"]));
    expect(sheet(sheets, "Offline").columns).toEqual(expect.arrayContaining(["Delivery (Out) +1", "Route B / Route C"]));
  });

  it("keeps every row the same width when only some products use an added column", () => {
    const mixed = { ...report, online: [withExtras.online[0], { product: { ...product, sku: "B2", name: "Beta" }, isSaved: true, entry: { openingStock: 1, remainingStock: 1 } }] };
    const online = sheet(dailyReportSheets(mixed, null), "Online");
    for (const row of online.rows) expect(row).toHaveLength(online.columns.length);
    expect(online.rows[1].slice(-5)).toEqual([0, 0, 0, 0, 1]); // no amounts for Beta: zeros, not a shifted row
  });

  it("is unchanged for a day with no added columns", () => {
    const sheets = dailyReportSheets(report, null);
    expect(sheet(sheets, "Online").columns).toHaveLength(3 + 8);
    expect(sheet(sheets, "Offline").columns).toHaveLength(3 + 9);
  });

  it("ignores keys that only look like added columns", () => {
    const odd = { ...report, online: [{ product, isSaved: true, entry: { ...report.online[0].entry, notAColumn__x1: 9, rts__x0: 4, rts__xA: 1 } }] };
    expect(sheet(dailyReportSheets(odd, null), "Online").columns).toHaveLength(3 + 8);
  });

  it("orders the slots 1, 2, 10 numerically, not as text", () => {
    const rows = [{ product, entry: { rts__x10: 1, rts__x2: 1, rts__x1: 1 } }];
    expect(columnsWithExtras(rows, [["rts", "RTS"]]).map(([key]) => key)).toEqual(["rts", "rts__x1", "rts__x2", "rts__x10"]);
  });

  it("the saved PDF reads the day's names, and still builds if they cannot be read", async () => {
    mocks.getDailyReport.mockResolvedValue({ ...withExtras, snapshot: null });
    mocks.getDailyOutflow.mockResolvedValue([]);
    mocks.names.impl = async () => ({ ONLINE: { fulfillmentOut__x1: "Shopee" }, OFFLINE: {} });
    const named = await buildDailyReportPdf(d("2026-10-24"));
    expect(mocks.names.calls).toEqual([d("2026-10-24")]);
    mocks.names.impl = async () => {
      throw new Error("db down");
    };
    const generic = await buildDailyReportPdf(d("2026-10-24"));
    expect(named).not.toBeNull();
    expect(generic).not.toBeNull();
    expect(named!.data.equals(generic!.data)).toBe(false); // the typed name changes the file
  });
});
