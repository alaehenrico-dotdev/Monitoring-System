import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getDailyReport: vi.fn(),
  getDailyOutflow: vi.fn(),
  // A plain function, not a spy: vitest tracks a spy's rejected promise without
  // handling it, which would report an "unhandled rejection" for a failure the
  // code under test does handle.
  options: { value: { hideEmptyRows: false, hideEmptyColumns: false } },
  names: { impl: (async () => ({ ONLINE: {}, OFFLINE: {} })) as (date: Date) => Promise<unknown>, calls: [] as Date[] },
  prisma: { dailyOnlineStock: { aggregate: vi.fn() }, dailyOfflineStock: { aggregate: vi.fn() } },
}));
vi.mock("./appSettings.service", () => ({ getReportOptions: async () => mocks.options.value }));
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
    expect(sheets[2].rows[0]).toEqual(["Class A", "", "Alpha", 4, 0, 0, 4, 0, 2, 0.5, 1.5]);
    expect(sheets[3].rows[0]).toEqual(["Class A", "A1", "Alpha", 13, 1.5, 14.5, null, null]);
    expect(sheets[4].rows).toEqual([[3, 2.5, 5.5]]);
  });

  it("does not print an Upsell (Out) column, even for a row that has an upsell amount", () => {
    // The sample offline row has upsellOut: 1. The entry pages have no such column; the
    // amount stays stored and counted in Remaining Stocks, it is just not a column here.
    expect(report.offline[0].entry.upsellOut).toBe(1);
    const offline = dailyReportSheets(report, null).find((x) => x.name === "Offline")!;
    expect(offline.columns.join("|")).not.toMatch(/upsell/i);
    expect(offline.columns).toEqual(["Category", "SKU", "Product", "Stocks (Opening)", "Stocks In (Ol→Off)", "Stocks Out (Off→Ol)", "Offline Stocks", "Production (In)", "Delivery (Out)", "Backloads", "Remaining Stocks"]);
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
    expect(sheet(sheets, "Offline").columns).toHaveLength(3 + 8);
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

describe("hiding empty rows and columns", () => {
  const beta = { category: "Class A", sku: "B2", name: "Beta" };
  // Alpha has figures. Beta has none at all. Nothing uses RTS, and Delivery's second added column is unused.
  const day = {
    ...report,
    online: [
      { product, isSaved: true, entry: { openingStock: 10, onlineStock: 10, productionIn: 5, fulfillmentOut: 3, rts: 0, remainingStock: 12 } },
      { product: beta, isSaved: true, entry: { openingStock: 0, onlineStock: 0, remainingStock: 0 } },
    ],
    offline: [
      { product, isSaved: true, entry: { openingStock: 4, offlineStock: 4, deliveryOut: 2, deliveryOut__x1: 2, deliveryOut__x2: 0, remainingStock: 2 } },
      { product: beta, isSaved: true, entry: { openingStock: 0, offlineStock: 0, deliveryOut: 0, deliveryOut__x1: 0, deliveryOut__x2: 0, remainingStock: 0 } },
    ],
    total: [
      { product, onlineRemainingStock: 12, offlineRemainingStock: 2, totalRemainingStock: 14, totalManualCount: null, totalVariance: null },
      { product: beta, onlineRemainingStock: 0, offlineRemainingStock: 0, totalRemainingStock: 0, totalManualCount: null, totalVariance: null },
    ],
  };
  const get = (hide?: { hideEmptyRows: boolean; hideEmptyColumns: boolean }) => dailyReportSheets(day, null, undefined, hide);
  const sheet = (sheets: ReturnType<typeof dailyReportSheets>, name: string) => sheets.find((x) => x.name === name)!;
  const summaryText = (sheets: ReturnType<typeof dailyReportSheets>) => JSON.stringify(sheet(sheets, "Summary").rows);

  it("shows everything by default - nothing is hidden unless an option is on", () => {
    const sheets = get();
    expect(sheet(sheets, "Online").rows).toHaveLength(2);
    expect(sheet(sheets, "Online").columns).toContain("RTS");
    expect(sheet(sheets, "Offline").columns).toContain("Delivery (Out) +2");
    expect(summaryText(sheets)).not.toMatch(/not listed|not shown/);
  });

  it("hide empty rows: leaves out a product with no figures, on every sheet that lists products", () => {
    const sheets = get({ hideEmptyRows: true, hideEmptyColumns: false });
    for (const name of ["Online", "Offline", "Consolidated"]) {
      expect(sheet(sheets, name).rows.map((r) => r[2])).toEqual(["Alpha"]);
    }
    expect(sheet(sheets, "Online").columns).toContain("RTS"); // columns untouched
  });

  it("hide empty columns: leaves out a column that is zero for every product, added columns included", () => {
    const sheets = get({ hideEmptyRows: false, hideEmptyColumns: true });
    expect(sheet(sheets, "Online").columns).not.toContain("RTS");
    expect(sheet(sheets, "Offline").columns).not.toContain("Delivery (Out) +2"); // the unused added column
    expect(sheet(sheets, "Offline").columns).toContain("Delivery (Out) +1"); // the used one stays
    expect(sheet(sheets, "Consolidated").columns).not.toContain("Manual Count"); // nobody counted
    expect(sheet(sheets, "Online").rows).toHaveLength(2); // rows untouched
  });

  it("every row stays exactly as wide as its header after columns are hidden", () => {
    const sheets = get({ hideEmptyRows: true, hideEmptyColumns: true });
    for (const name of ["Online", "Offline", "Consolidated"]) {
      const t = sheet(sheets, name);
      for (const row of t.rows) expect(row).toHaveLength(t.columns.length);
    }
  });

  it("every figure that remains is the same figure it was, under the same heading", () => {
    const full = sheet(get(), "Online");
    const trimmed = sheet(get({ hideEmptyRows: true, hideEmptyColumns: true }), "Online");
    expect(trimmed.columns.length).toBeLessThan(full.columns.length);
    trimmed.columns.forEach((heading, i) => {
      expect(trimmed.rows[0][i], heading).toEqual(full.rows[0][full.columns.indexOf(heading)]);
    });
    // Whatever was hidden was zero for every product: nothing with a figure is lost.
    full.columns.forEach((heading, i) => {
      if (!trimmed.columns.includes(heading)) expect(full.rows.every((r) => !r[i]), heading).toBe(true);
    });
  });

  it("says in the Summary what was left out, so nobody wonders where a product went", () => {
    const text = summaryText(get({ hideEmptyRows: true, hideEmptyColumns: true }));
    expect(text).toContain("Products with no figures, not listed");
    expect(text).toContain("Online 1, Offline 1, Consolidated 1");
    expect(text).toContain("Empty columns, not shown");
    expect(text).toContain("RTS");
  });

  it("leaves the Audit and Daily Out sheets alone", () => {
    const before = get();
    const after = get({ hideEmptyRows: true, hideEmptyColumns: true });
    expect(sheet(after, "Audit")).toEqual(sheet(before, "Audit"));
    expect(sheet(after, "Daily Out")).toEqual(sheet(before, "Daily Out"));
  });

  it("the saved PDF follows the Settings switches", async () => {
    mocks.getDailyReport.mockResolvedValue({ ...day, snapshot: null });
    mocks.getDailyOutflow.mockResolvedValue([]);
    mocks.names.impl = async () => ({ ONLINE: {}, OFFLINE: {} });
    mocks.options.value = { hideEmptyRows: false, hideEmptyColumns: false };
    const full = await buildDailyReportPdf(d("2026-10-24"));
    mocks.options.value = { hideEmptyRows: true, hideEmptyColumns: true };
    const trimmed = await buildDailyReportPdf(d("2026-10-24"));
    mocks.options.value = { hideEmptyRows: false, hideEmptyColumns: false };
    expect(full).not.toBeNull();
    expect(trimmed).not.toBeNull();
    expect(trimmed!.data.equals(full!.data)).toBe(false);
  });
});
