import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ReactNode } from "react";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { DailyReportPage } from "./DailyReportPage";
import type { DailyReport } from "../api/reports";
import { subscribeNotices, type AppNotice } from "../utils/notify";

const api = vi.hoisted(() => ({
  getDailyReport: vi.fn(),
  getDailyOut: vi.fn(),
  getDayExtraNames: vi.fn(),
  saveDailyReportToDrive: vi.fn(),
  recordReportHistory: vi.fn(),
  downloadExcel: vi.fn(),
  downloadTablePdf: vi.fn(),
}));
vi.mock("../api/reports", () => ({ getDailyReport: api.getDailyReport }));
vi.mock("../api/dailyOut", () => ({ getDailyOut: api.getDailyOut }));
vi.mock("../api/extraLabels", () => ({ getDayExtraNames: api.getDayExtraNames }));
vi.mock("../api/drive", () => ({ saveDailyReportToDrive: api.saveDailyReportToDrive }));
vi.mock("../api/reportHistory", () => ({ recordReportHistory: api.recordReportHistory }));
vi.mock("../utils/excel", async (orig) => ({ ...(await orig<typeof import("../utils/excel")>()), downloadExcel: api.downloadExcel }));
vi.mock("../utils/tablePdf", () => ({ downloadTablePdf: api.downloadTablePdf }));
vi.mock("../components/PageHeader", () => ({ PageHeader: ({ children }: { children: ReactNode }) => <div>{children}</div> }));
vi.mock("../components/StockGrid", () => ({ StockGrid: () => <div>stock grid</div> }));
vi.mock("../components/TotalStocksTable", () => ({ TotalStocksTable: () => <div>total table</div> }));
vi.mock("../context/RealtimeContext", () => ({ useRealtimeVersion: () => 0 }));
vi.mock("../context/AuthContext", () => ({ useAuth: () => ({ user: { id: 1, role: "SUPERVISOR_ADMIN" } }) }));
vi.mock("../hooks/useTopProgress", () => ({ useTopProgress: () => ({ track: (fn: () => Promise<unknown>) => fn() }) }));
vi.mock("../utils/unsavedWork", () => ({ findUnsavedWork: () => [] }));

const DATE = "2026-10-22";
const row = (extra = {}) => ({ product: { id: 1, category: "Class A", sku: "A1", name: "Alpha" }, isSaved: true, entry: { openingStock: 1 }, ...extra });
const report = (over: Partial<DailyReport> = {}): DailyReport =>
  ({
    date: DATE,
    online: [row()],
    offline: [row({ isSaved: false })],
    total: [],
    audit: [
      { product: { category: "Class A", sku: "A1", name: "Alpha" }, shift: "NIGHT", location: "ONLINE", systemRemainingStock: 13, manualCount: 12, variance: 1, remarks: "Spillage", published: true, isOpeningBalance: false },
    ],
    snapshot: null,
    ...over,
  }) as unknown as DailyReport;

let notices: AppNotice[] = [];
let stop = () => {};

beforeEach(() => {
  vi.clearAllMocks();
  notices = [];
  stop();
  stop = subscribeNotices((n) => notices.push(n));
  api.getDailyReport.mockResolvedValue(report());
  api.getDailyOut.mockResolvedValue([{ date: DATE, onlineOut: 3, offlineOut: 2, totalOut: 5 }]);
  api.getDayExtraNames.mockResolvedValue({ ONLINE: {}, OFFLINE: {} });
  api.saveDailyReportToDrive.mockResolvedValue({ status: "saved" });
  api.recordReportHistory.mockResolvedValue({});
  api.downloadTablePdf.mockResolvedValue(undefined);
});

function open(url = `/daily-report?date=${DATE}`) {
  return render(
    <MemoryRouter initialEntries={[url]}>
      <DailyReportPage />
    </MemoryRouter>,
  );
}
const generate = () => fireEvent.click(screen.getByRole("button", { name: /^Generate$/ }));
const confirm = () => fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Generate" }));

describe("Generate asks first", () => {
  it("opens a confirmation instead of generating straight away, naming the date and Google Drive", () => {
    open();
    generate();
    const dialog = screen.getByRole("dialog");
    expect(within(dialog).getByText(/Generate the Daily Report for/)).toBeInTheDocument();
    expect(dialog).toHaveTextContent(/saved to Google Drive/);
    expect(dialog).toHaveTextContent(/replaces\s+that file/);
    expect(api.getDailyReport).not.toHaveBeenCalled();
    expect(api.saveDailyReportToDrive).not.toHaveBeenCalled();
  });

  it("does nothing at all when cancelled", () => {
    open();
    generate();
    fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Cancel" }));
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(api.getDailyReport).not.toHaveBeenCalled();
    expect(api.saveDailyReportToDrive).not.toHaveBeenCalled();
  });

  it("generates the picked date and saves it to Drive once confirmed", async () => {
    open();
    generate();
    confirm();
    await waitFor(() => expect(api.saveDailyReportToDrive).toHaveBeenCalledWith(DATE));
    expect(api.getDailyReport).toHaveBeenCalledWith(DATE);
    expect(api.saveDailyReportToDrive).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(notices).toEqual([{ level: "success", message: `Daily Report for ${DATE} saved to Google Drive.` }]));
  });

  it("says so, rather than claiming a save, when Drive already has exactly this report", async () => {
    api.saveDailyReportToDrive.mockResolvedValue({ status: "unchanged" });
    open();
    generate();
    confirm();
    await waitFor(() => expect(notices).toEqual([{ level: "info", message: `Daily Report for ${DATE} is already up to date in Google Drive.` }]));
  });

  it("stays quiet when Drive is not connected or the day has nothing saved - the report still generates", async () => {
    for (const status of ["not-connected", "empty"]) {
      notices.length = 0;
      api.saveDailyReportToDrive.mockResolvedValue({ status });
      const { unmount } = open();
      generate();
      confirm();
      await waitFor(() => expect(api.saveDailyReportToDrive).toHaveBeenCalled());
      await screen.findByText(/Audit —/);
      expect(notices).toEqual([]);
      unmount();
      vi.clearAllMocks();
      api.getDailyReport.mockResolvedValue(report());
      api.getDailyOut.mockResolvedValue([]);
      api.getDayExtraNames.mockResolvedValue({ ONLINE: {}, OFFLINE: {} });
    }
  });

  it("shows the reason as an error when saving to Drive fails, and still shows the report", async () => {
    api.saveDailyReportToDrive.mockRejectedValue(new Error("Drive is full"));
    open();
    generate();
    confirm();
    await waitFor(() => expect(notices).toHaveLength(1));
    expect(notices[0]).toMatchObject({ level: "error", message: expect.stringContaining("Drive is full") });
    expect(await screen.findByText(/Audit —/)).toBeInTheDocument();
  });

  it("does not save a day that has no data - the empty-day notice comes instead", async () => {
    api.getDailyReport.mockResolvedValue(report({ online: [row({ isSaved: false })] as never, offline: [], audit: [] }));
    open();
    generate();
    confirm();
    expect(await screen.findByText("No report to generate")).toBeInTheDocument();
    expect(api.saveDailyReportToDrive).not.toHaveBeenCalled();
  });

  it("never saves to Drive for a report opened from history - that is a re-download, not a new report", async () => {
    open(`/daily-report?history=1&date=${DATE}`);
    await waitFor(() => expect(api.getDailyReport).toHaveBeenCalled());
    await screen.findByText(/Audit —/);
    expect(api.saveDailyReportToDrive).not.toHaveBeenCalled();
    expect(screen.queryByRole("dialog")).toBeNull();
  });
});

describe("the Audit section", () => {
  it("shows every count with the system figure, the count, the variance, remarks and status", async () => {
    open();
    generate();
    confirm();
    const heading = await screen.findByText(/Audit —/);
    const table = heading.nextElementSibling as HTMLElement;
    const cells = within(table).getAllByRole("row")[1].querySelectorAll("td");
    expect([...cells].map((c) => c.textContent)).toEqual(["Class A", "A1", "Alpha", "Night", "Online", "13", "12", "1", "Spillage", "Published"]);
  });

  it("says so when no counts were saved that date", async () => {
    api.getDailyReport.mockResolvedValue(report({ audit: [] }));
    open();
    generate();
    confirm();
    expect(await screen.findByText("No audit counts were saved for this date.")).toBeInTheDocument();
  });

  it("copes with an older frozen report that has no audit stored", async () => {
    api.getDailyReport.mockResolvedValue(report({ audit: undefined }));
    open();
    generate();
    confirm();
    expect(await screen.findByText("No audit counts were saved for this date.")).toBeInTheDocument();
  });
});

describe("the report's own exports stay out of the Exports folder in Drive", () => {
  async function generated() {
    open();
    generate();
    confirm();
    await screen.findByText(/Audit —/);
  }
  const menu = (name: string) => fireEvent.click(screen.getByRole("menuitem", { name }));

  it("Export Excel includes the audit and is not copied to the Exports folder", async () => {
    await generated();
    menu("Export");
    fireEvent.click(await screen.findByRole("menuitem", { name: /Export Excel/ }));
    await waitFor(() => expect(api.downloadExcel).toHaveBeenCalled());
    const [name, html, opts] = api.downloadExcel.mock.calls[0];
    expect(name).toBe(`daily-report-${DATE}.xls`);
    expect(html).toContain(`AUDIT - ${DATE}`);
    expect(html).toContain("Spillage");
    expect(opts).toEqual({ driveCopy: false });
  });

  it("Download PDF includes the audit and is not copied to the Exports folder", async () => {
    await generated();
    menu("Export");
    fireEvent.click(await screen.findByRole("menuitem", { name: /Download PDF/ }));
    await waitFor(() => expect(api.downloadTablePdf).toHaveBeenCalled());
    const spec = api.downloadTablePdf.mock.calls[0][0];
    expect(spec.driveCopy).toBe(false);
    expect(spec.sections.map((s: { title?: string }) => s.title)).toContain(`AUDIT - ${DATE}`);
  });
});

describe("View > Hide products with no figures / Hide empty columns", () => {
  const alpha = { product: { id: 1, category: "Class A", sku: "A1", name: "Alpha" }, isSaved: true, entry: { openingStock: 10, onlineStock: 10, remainingStock: 10, rts: 0 } };
  const beta = { product: { id: 2, category: "Class A", sku: "B2", name: "Betamax" }, isSaved: true, entry: { openingStock: 0, onlineStock: 0, remainingStock: 0, rts: 0 } };
  const totalRow = (p: typeof alpha.product, remaining: number) => ({ product: p, onlineRemainingStock: remaining, offlineRemainingStock: 0, totalRemainingStock: remaining, totalManualCount: null, totalVariance: null });

  beforeEach(() => {
    localStorage.clear();
    api.getDailyReport.mockResolvedValue(report({ online: [alpha, beta], offline: [], total: [totalRow(alpha.product, 10), totalRow(beta.product, 0)] } as unknown as Partial<DailyReport>));
  });

  async function generated() {
    open();
    generate();
    confirm();
    await screen.findByText(/Audit —/);
  }
  const choose = async (menuName: string, itemName: RegExp) => {
    fireEvent.click(screen.getByRole("menuitem", { name: menuName }));
    fireEvent.click(await screen.findByRole("menuitemradio", { name: itemName }));
  };
  const downloadPdf = async () => {
    fireEvent.click(screen.getByRole("menuitem", { name: "Export" }));
    fireEvent.click(await screen.findByRole("menuitem", { name: /Download PDF/ }));
    await waitFor(() => expect(api.downloadTablePdf).toHaveBeenCalled());
    return api.downloadTablePdf.mock.calls.at(-1)![0] as { sections: { title?: string; columns: { header: string }[]; rows: { cells: string[] }[] }[] };
  };
  const section = (spec: Awaited<ReturnType<typeof downloadPdf>>, start: string) => spec.sections.find((x) => x.title?.startsWith(start))!;
  const names = (sec: ReturnType<typeof section>) => sec.rows.flatMap((r) => r.cells).join("|");

  it("lists every product and column by default - nothing is hidden until it is switched on", async () => {
    await generated();
    const spec = await downloadPdf();
    expect(names(section(spec, "ONLINE"))).toContain("Betamax");
    expect(section(spec, "ONLINE").columns.map((c) => c.header)).toContain("RTS");
    expect(screen.queryByText(/Not shown:/)).toBeNull();
  });

  it("hides a product with no figures from the PDF and says so on the page", async () => {
    await generated();
    await choose("View", /Hide products with no figures/);
    expect(await screen.findByText(/Not shown: 2 products with no figures/)).toBeInTheDocument(); // Online and Consolidated
    const spec = await downloadPdf();
    expect(names(section(spec, "ONLINE"))).toContain("Alpha");
    expect(names(section(spec, "ONLINE"))).not.toContain("Betamax");
    expect(names(section(spec, "CONSOLIDATED"))).not.toContain("Betamax");
    expect(section(spec, "ONLINE").columns.map((c) => c.header)).toContain("RTS"); // columns are a separate switch
  });

  it("hides an empty column from the PDF, and the product rows stay", async () => {
    await generated();
    await choose("View", /Hide empty columns/);
    const spec = await downloadPdf();
    const headers = section(spec, "ONLINE").columns.map((c) => c.header);
    expect(headers).not.toContain("RTS");
    expect(headers).toContain("Remaining Stocks");
    expect(names(section(spec, "ONLINE"))).toContain("Betamax"); // rows are a separate switch
    // Everything nobody used that day (stock in/out, production, fulfillment, RTS) is counted.
    expect(await screen.findByText(/Not shown: 5 empty columns/)).toBeInTheDocument();
  });

  it("leaves Excel out the same products, so the screen, the PDF and Excel agree", async () => {
    await generated();
    await choose("View", /Hide products with no figures/);
    fireEvent.click(screen.getByRole("menuitem", { name: "Export" }));
    fireEvent.click(await screen.findByRole("menuitem", { name: /Export Excel/ }));
    await waitFor(() => expect(api.downloadExcel).toHaveBeenCalled());
    const html = api.downloadExcel.mock.calls.at(-1)![1] as string;
    expect(html).toContain("Alpha");
    expect(html).not.toContain("Betamax");
  });

  it("turning it off again shows everything and removes the note", async () => {
    await generated();
    await choose("View", /Hide products with no figures/);
    await screen.findByText(/Not shown:/);
    await choose("View", /Hide products with no figures/);
    await waitFor(() => expect(screen.queryByText(/Not shown:/)).toBeNull());
    expect(names(section(await downloadPdf(), "ONLINE"))).toContain("Betamax");
  });

  it("remembers the choice in this browser", async () => {
    await generated();
    await choose("View", /Hide products with no figures/);
    await choose("View", /Hide empty columns/);
    await waitFor(() => expect(localStorage.getItem("ala-eh-hide-empty-rows:daily-report")).toBe("1"));
    expect(localStorage.getItem("ala-eh-hide-empty-columns:daily-report")).toBe("1");
  });

  it("shows the current state in the menu with a check", async () => {
    await generated();
    fireEvent.click(screen.getByRole("menuitem", { name: "View" }));
    const rowsItem = await screen.findByRole("menuitemradio", { name: /Hide products with no figures/ });
    expect(rowsItem).toHaveAttribute("aria-checked", "false");
    fireEvent.click(rowsItem);
    fireEvent.click(screen.getByRole("menuitem", { name: "View" }));
    expect(await screen.findByRole("menuitemradio", { name: /Hide products with no figures/ })).toHaveAttribute("aria-checked", "true");
  });
});

