import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ReactNode } from "react";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { ManualCountPage } from "./ManualCountPage";
import { chooseFromMenu } from "./menuTestHelpers";

const api = vi.hoisted(() => ({ getManualCountGrid: vi.fn(), saveManualCount: vi.fn(), getVarianceTrace: vi.fn(), setCountRemarks: vi.fn(), publishManualCounts: vi.fn() }));
vi.mock("../context/AuthContext", () => ({ useAuth: () => ({ user: { id: 1, name: "Sup", username: "sup", role: "SUPERVISOR_ADMIN" } }) }));
vi.mock("../api/manualCounts", () => api);
vi.mock("../api/reportHistory", () => ({ recordReportHistory: vi.fn().mockResolvedValue({}) }));
vi.mock("../components/PageHeader", () => ({
  PageHeader: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));
vi.mock("../components/CsvTools", () => ({ CsvTools: () => null }));
vi.mock("../hooks/useTopProgress", () => ({ useTopProgress: () => ({ start: vi.fn(), done: vi.fn() }) }));
vi.mock("../context/RealtimeContext", () => ({ useRealtimeVersion: () => 0 }));

const product = (id: number, name: string) => ({ id, sku: `SKU${id}`, name, category: "Sauces", unit: "pc", isActive: true, sortOrder: id });

/// One saved opening balance (count 120 against a system figure of 0) and one
/// ordinary saved count that really is off by 2.
beforeEach(() => {
  vi.clearAllMocks();
  sessionStorage.clear();
  Element.prototype.scrollIntoView = vi.fn();
  api.getManualCountGrid.mockImplementation((_d: string, _s: string, loc: "ONLINE" | "OFFLINE") => {
    const base = { entryDate: "2026-10-09", shift: "NIGHT", location: loc };
    if (loc === "OFFLINE") {
      return Promise.resolve([
        { product: product(1, "Soy Sauce"), entry: { ...base, productId: 1, systemRemainingStock: 0, manualCount: null, variance: null, isOpeningBalance: true }, isSaved: false, isFlagged: false },
        { product: product(2, "Vinegar"), entry: { ...base, productId: 2, systemRemainingStock: 0, manualCount: null, variance: null, isOpeningBalance: false }, isSaved: false, isFlagged: false },
      ]);
    }
    return Promise.resolve([
      { product: product(1, "Soy Sauce"), entry: { ...base, productId: 1, systemRemainingStock: 0, manualCount: 120, variance: 0, isOpeningBalance: true }, isSaved: true, isFlagged: false },
      { product: product(2, "Vinegar"), entry: { ...base, productId: 2, systemRemainingStock: 10, manualCount: 8, variance: 2, isOpeningBalance: false }, isSaved: true, isFlagged: true },
    ]);
  });
});

// The save status in the toolbar is a status region too; this is the page's own note.
const openingNote = () => screen.getAllByRole("status").find((el) => /first count/.test(el.textContent ?? ""))!;

describe("ManualCountPage - opening balance", () => {
  it("labels a first count as Opening instead of showing a variance, and explains why", async () => {
    render(
      <MemoryRouter>
        <ManualCountPage />
      </MemoryRouter>,
    );
    await screen.findByText("Sauces");
    chooseFromMenu("View", /Expand all categories/);

    const soyRow = (await screen.findByText("Soy Sauce")).closest("tr")!;
    expect(soyRow.textContent).toContain("Opening");

    const vinegarRow = screen.getByText("Vinegar").closest("tr")!;
    expect(vinegarRow.textContent).not.toContain("Opening");

    expect(openingNote().textContent).toMatch(/1 first count will be recorded as opening balances/);
    expect(openingNote().textContent).toMatch(/only becomes a shift.s opening stock if you tick the option/);
  });
});
