import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ChangeLogEntry } from "../types";
import { ChangeLogPage } from "./ChangeLogPage";

const api = vi.hoisted(() => ({
  listChangeLogPage: vi.fn(),
  listChangeLogUsers: vi.fn(),
  exportChangeLogCsv: vi.fn(),
  listProducts: vi.fn(),
  saveBlob: vi.fn(),
}));

vi.mock("../api/changeLog", () => ({
  listChangeLogPage: api.listChangeLogPage,
  listChangeLogUsers: api.listChangeLogUsers,
  exportChangeLogCsv: api.exportChangeLogCsv,
}));
vi.mock("../api/products", () => ({ listProducts: api.listProducts }));
// The real header pulls in auth/theme/nav providers that have nothing to do with
// what the page lists.
vi.mock("../components/PageHeader", () => ({
  PageHeader: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));
vi.mock("../utils/saveBlob", () => ({ saveBlob: api.saveBlob }));

function entry(over: Partial<ChangeLogEntry> & { id: number }): ChangeLogEntry {
  return {
    tableName: "manual_counts",
    recordId: 4821,
    action: "UPDATE",
    changedAt: "2026-10-09T08:00:00.000Z",
    changedBy: { id: 7, name: "Ana Cruz", username: "ana", role: "SUPERVISOR_ADMIN" },
    oldValue: null,
    newValue: null,
    context: { productId: 5, sku: "AFP007", productName: "Soy Sauce 1L", entryDate: `${new Date().getFullYear()}-10-09`, shift: "NIGHT", location: "ONLINE" },
    source: null,
    summary: "Manual count 12 → 10",
    changes: [{ key: "manualCount", label: "Manual count", before: "12", after: "10" }],
    ...over,
  };
}

/// Every category asks the server for its own table, so a fake server answers
/// each request with only that table's rows (and `nextCursor` null).
function serve(items: ChangeLogEntry[]) {
  api.listChangeLogPage.mockImplementation(async (filters: { tableName?: string }) => ({
    items: items.filter((e) => !filters.tableName || e.tableName === filters.tableName),
    nextCursor: null,
  }));
}

beforeEach(() => {
  vi.clearAllMocks();
  // jsdom has no layout, so no scrollIntoView (the dropdown calls it on open).
  Element.prototype.scrollIntoView = vi.fn();
  api.listChangeLogUsers.mockResolvedValue([{ id: 7, name: "Ana Cruz", username: "ana" }]);
  api.listProducts.mockResolvedValue([{ id: 5, sku: "AFP007", name: "Soy Sauce 1L" }]);
  serve([entry({ id: 1 })]);
});

const lastFilters = () => api.listChangeLogPage.mock.calls.at(-1)![0];

describe("ChangeLogPage - readable rows", () => {
  it("shows a readable record label and a one-line summary instead of the raw id", async () => {
    render(<ChangeLogPage />);

    expect(await screen.findByText("AFP007 · Soy Sauce 1L · Oct 9 · Night · Online")).toBeTruthy();
    expect(screen.getByText("Manual count 12 → 10")).toBeTruthy();
    expect(screen.queryByText("#4821")).toBeNull();
  });

  it("still expands to the field-by-field details", async () => {
    render(<ChangeLogPage />);

    fireEvent.click(await screen.findByText("Manual count 12 → 10"));

    expect(screen.getByText("Field")).toBeTruthy();
    expect(screen.getByText("Manual count")).toBeTruthy();
  });

  it("tags bulk rows so they stand apart from a person's edits", async () => {
    serve([
        entry({ id: 3, source: "import" }),
        entry({ id: 2, tableName: "system", recordId: 0, context: null, summary: null, source: "reset", action: "DELETE", newValue: { event: "data_reset", deleted: { manual_counts: 4 } } }),
        entry({ id: 1 }),
      ]);
    render(<ChangeLogPage />);

    expect(await screen.findByText("CSV import")).toBeTruthy();
    expect(screen.getByText("Data reset")).toBeTruthy();
    expect(screen.getAllByText(/^(CSV import|Data reset)$/)).toHaveLength(2);
  });

  it("searches the SKU and the summary text", async () => {
    serve([entry({ id: 2 }), entry({ id: 1, context: { productId: 9, sku: "ZZZ001", productName: "Vinegar", entryDate: null, shift: null, location: null }, summary: "Production in 1 → 2" })]);
    render(<ChangeLogPage />);
    await screen.findByText("Production in 1 → 2");

    fireEvent.change(screen.getByRole("searchbox"), { target: { value: "zzz001" } });

    expect(screen.queryByText("Manual count 12 → 10")).toBeNull();
    expect(screen.getByText("Production in 1 → 2")).toBeTruthy();
  });
});

describe("ChangeLogPage - filters", () => {
  it("starts unfiltered", async () => {
    render(<ChangeLogPage />);
    await screen.findByText("Manual count 12 → 10");
    // Nothing but each category's own table is sent.
    expect(api.listChangeLogPage.mock.calls.every((c) => Object.keys(JSON.parse(JSON.stringify(c[0]))).join() === "tableName")).toBe(true);
  });

  it("sends the CSV-import filter to the server and reloads", async () => {
    render(<ChangeLogPage />);
    await screen.findByText("Manual count 12 → 10");

    fireEvent.click(screen.getAllByLabelText("From CSV import")[0]);

    await waitFor(() => expect(lastFilters()).toMatchObject({ importOnly: true }));
  });

  async function pick(label: string, option: string) {
    fireEvent.click(screen.getByRole("button", { name: new RegExp(label, "i") }));
    fireEvent.click(await screen.findByRole("option", { name: option }));
  }

  it("filters by date range from one picker", async () => {
    render(<ChangeLogPage />);
    await screen.findByText("Manual count 12 → 10");

    fireEvent.click(screen.getByRole("button", { name: /^Date range:/ }));
    fireEvent.click(await screen.findByRole("button", { name: "Last 7 days" }));

    await waitFor(() => expect(lastFilters().dateFrom).toBeTruthy());
    const { dateFrom, dateTo } = lastFilters();
    expect(new Date(dateTo).getTime()).toBeGreaterThan(new Date(dateFrom).getTime());
    // One field for the range, not a From and a To.
    expect(screen.queryByRole("button", { name: /^(From|To) date/ })).toBeNull();
  });

  it("sends shift, action and user as server filters", async () => {
    render(<ChangeLogPage />);
    await screen.findByText("Manual count 12 → 10");
    await waitFor(() => expect(api.listChangeLogUsers).toHaveBeenCalled());

    await pick("Shift", "Night");
    await waitFor(() => expect(lastFilters()).toMatchObject({ shift: "NIGHT" }));

    await pick("Action", "Delete");
    await waitFor(() => expect(lastFilters()).toMatchObject({ shift: "NIGHT", action: "DELETE" }));

    await pick("User", "Ana Cruz");
    await waitFor(() => expect(lastFilters()).toMatchObject({ userId: 7 }));
  });

  it("filters by product through the SKU picker", async () => {
    render(<ChangeLogPage />);
    await screen.findByText("Manual count 12 → 10");
    await waitFor(() => expect(api.listProducts).toHaveBeenCalled());

    await pick("Product", "AFP007 · Soy Sauce 1L");

    await waitFor(() => expect(lastFilters()).toMatchObject({ productId: 5 }));
  });
});

describe("ChangeLogPage - generated reports", () => {
  async function pick(label: string, option: string) {
    fireEvent.click(screen.getByRole("button", { name: new RegExp(label, "i") }));
    fireEvent.click(await screen.findByRole("option", { name: option }));
  }

  it("lists generated reports as a one-line summary", async () => {
    serve([entry({ id: 4, tableName: "reports", recordId: 3, action: "CREATE", context: null, summary: "Daily Report · Online · 2026-10-09", changes: [] })]);
    render(<ChangeLogPage />);

    expect(await screen.findByText("Daily Report · Online · 2026-10-09")).toBeTruthy();
    expect(screen.getByText("Generated report")).toBeTruthy();
  });

  it("offers report type and Online/Offline filters only for the Reports table", async () => {
    render(<ChangeLogPage />);
    await screen.findByText("Manual count 12 → 10");
    expect(screen.queryByRole("button", { name: /Report section/i })).toBeNull();

    await pick("Table", "Reports");
    await waitFor(() => expect(lastFilters()).toMatchObject({ tableName: "reports" }));

    await pick("Report type", "Variance Report");
    await waitFor(() => expect(lastFilters()).toMatchObject({ reportType: "Variance Report" }));

    await pick("Report section", "Offline");
    await waitFor(() => expect(lastFilters()).toMatchObject({ reportType: "Variance Report", reportSection: "offline" }));
  });

  it("drops the report filters when leaving the Reports table", async () => {
    render(<ChangeLogPage />);
    await screen.findByText("Manual count 12 → 10");
    await pick("Table", "Reports");
    await pick("Report section", "Online");
    await waitFor(() => expect(lastFilters()).toMatchObject({ reportSection: "online" }));

    await pick("Table", "All tables");

    await waitFor(() => expect(lastFilters().reportSection).toBeUndefined());
  });
});

describe("ChangeLogPage - admin events and automatic changes", () => {
  it("reads sign-ins, backups and restores in plain words", async () => {
    const sys = (id: number, newValue: object, changedBy: ChangeLogEntry["changedBy"] = null) =>
      entry({ id, tableName: "system", recordId: 0, action: "CREATE", context: null, summary: null, changes: [], newValue, changedBy });
    serve([
        sys(4, { event: "login", username: "ana" }),
        sys(3, { event: "login_failed", username: "mallory" }),
        sys(2, { event: "backup_download", fileName: "x.sql" }),
        sys(1, { event: "backup_restore" }),
      ]);
    render(<ChangeLogPage />);

    expect(await screen.findByText("Signed in (ana)")).toBeTruthy();
    expect(screen.getByText("Failed sign-in (mallory)")).toBeTruthy();
    expect(screen.getByText("Database backup downloaded")).toBeTruthy();
    expect(screen.getByText("Database restored from a backup")).toBeTruthy();
  });

  it("names the account a users change is about, never a bare id", async () => {
    serve([entry({ id: 5, tableName: "users", recordId: 12, action: "UPDATE", context: null, summary: "Active Yes → No", newValue: { username: "cleo", isActive: false } })]);
    render(<ChangeLogPage />);
    expect(await screen.findByText("User · cleo")).toBeTruthy();
    expect(screen.getByText("Active Yes → No")).toBeTruthy();
  });

  it("tags a follow-on change the system made, pointing at its cause", async () => {
    serve([entry({ id: 9, tableName: "daily_online_stock", causedById: 7, summary: "Opening stock 90 → 100" })]);
    render(<ChangeLogPage />);
    expect(await screen.findByText("Auto · from #7")).toBeTruthy();
  });
});

describe("ChangeLogPage - paging and export", () => {
  async function pickTable(option: string) {
    fireEvent.click(screen.getByRole("button", { name: /table/i }));
    fireEvent.click(await screen.findByRole("option", { name: option }));
  }

  it("asks for 20 rows per category with every table showing, 100 with one table picked", async () => {
    render(<ChangeLogPage />);
    await screen.findByText("Manual count 12 → 10");
    expect(api.listChangeLogPage.mock.calls.every((c) => c[1].limit === 20)).toBe(true);
    // One request per category, each scoped to its own table.
    const tables = api.listChangeLogPage.mock.calls.map((c) => c[0].tableName);
    expect(new Set(tables).size).toBe(tables.length);
    expect(tables).toContain("manual_counts");

    api.listChangeLogPage.mockClear();
    await pickTable("Manual Count");
    await waitFor(() => expect(api.listChangeLogPage).toHaveBeenCalled());
    expect(api.listChangeLogPage.mock.calls.every((c) => c[0].tableName === "manual_counts" && c[1].limit === 100)).toBe(true);
  });

  /// A fake server holding `total` Manual Count rows, answering by (offset, limit).
  function serveManualCounts(total: number, flagged?: { importOnly: ChangeLogEntry }) {
    api.listChangeLogPage.mockImplementation(
      async (f: { tableName?: string; importOnly?: boolean }, page: { offset?: number; limit?: number }) => {
        if (f.tableName !== "manual_counts") return { items: [], nextCursor: null, total: 0 };
        if (f.importOnly && flagged) return { items: [flagged.importOnly], nextCursor: null, total: 1 };
        const offset = page.offset ?? 0;
        const n = Math.max(0, Math.min(page.limit ?? 20, total - offset));
        return {
          items: Array.from({ length: n }, (_, i) => entry({ id: total - offset - i, summary: `Row ${total - offset - i}` })),
          nextCursor: null,
          total,
        };
      },
    );
  }

  it("pages one category by number, in its own header, with Showing x–y of N", async () => {
    serveManualCounts(45);
    render(<ChangeLogPage />);

    expect(await screen.findByText("Row 45")).toBeTruthy();
    const pager = screen.getByRole("navigation", { name: "Manual Count pages" });
    expect(pager.textContent).toContain("Showing 1–20 of 45 records");
    expect(pager.textContent).toContain("1 / 3");
    // The pager sits in the category's header row.
    expect(pager.closest("tr")?.textContent).toContain("Manual Count");

    fireEvent.click(screen.getByRole("button", { name: "Next page" }));
    expect(await screen.findByText("Row 25")).toBeTruthy();
    expect(api.listChangeLogPage.mock.calls.at(-1)![1]).toMatchObject({ offset: 20, limit: 20, withTotal: true });
    expect(screen.queryByText("Row 45")).toBeNull();
    expect(screen.getByRole("navigation", { name: "Manual Count pages" }).textContent).toContain("Showing 21–40 of 45 records");

    fireEvent.click(screen.getByRole("button", { name: "First page" }));
    expect(await screen.findByText("Row 45")).toBeTruthy();
  });

  it("changes rows per page and goes back to page 1", async () => {
    serveManualCounts(45);
    render(<ChangeLogPage />);
    await screen.findByText("Row 45");
    fireEvent.click(screen.getByRole("button", { name: "Next page" }));
    await screen.findByText("Row 25");

    fireEvent.change(screen.getByLabelText("Rows per page"), { target: { value: "50" } });

    expect(await screen.findByText("Row 1")).toBeTruthy();
    expect(api.listChangeLogPage.mock.calls.at(-1)![1]).toMatchObject({ offset: 0, limit: 50 });
    // 45 rows fit on one 50-row page, so there is nothing left to page.
    expect(screen.getByRole("navigation", { name: "Manual Count pages" }).textContent).toContain("1 / 1");
  });

  it("goes back to the first page when the filters change", async () => {
    serveManualCounts(45, { importOnly: entry({ id: 9, summary: "Fresh view row" }) });
    render(<ChangeLogPage />);
    fireEvent.click(await screen.findByRole("button", { name: "Next page" }));
    await screen.findByText("Row 25");

    fireEvent.click(screen.getAllByLabelText("From CSV import")[0]);

    expect(await screen.findByText("Fresh view row")).toBeTruthy();
    expect(screen.queryByText("Row 25")).toBeNull();
  });

  it("exports with the current filters, not just the loaded rows", async () => {
    api.exportChangeLogCsv.mockResolvedValue(new Blob(["x"]));
    render(<ChangeLogPage />);
    await screen.findByText("Manual count 12 → 10");
    fireEvent.click(screen.getAllByLabelText("From CSV import")[0]);
    await waitFor(() => expect(lastFilters()).toMatchObject({ importOnly: true }));

    fireEvent.click(screen.getByRole("button", { name: "Export CSV" }));

    await waitFor(() => expect(api.saveBlob).toHaveBeenCalled());
    expect(api.exportChangeLogCsv).toHaveBeenCalledWith(expect.objectContaining({ importOnly: true }));
    expect(api.saveBlob.mock.calls[0][1]).toBe("change-log.csv");
  });

  it("reports a failed export instead of failing silently", async () => {
    api.exportChangeLogCsv.mockRejectedValue(new Error("Export failed"));
    render(<ChangeLogPage />);
    await screen.findByText("Manual count 12 → 10");

    fireEvent.click(screen.getByRole("button", { name: "Export CSV" }));

    expect(await screen.findByText("Export failed")).toBeTruthy();
    expect(api.saveBlob).not.toHaveBeenCalled();
  });
});

