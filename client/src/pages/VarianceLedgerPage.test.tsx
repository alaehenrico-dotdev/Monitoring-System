import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ReactNode } from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { VarianceLedgerPage } from "./VarianceLedgerPage";

const api = vi.hoisted(() => ({ getVarianceReport: vi.fn() }));
vi.mock("../api/manualCounts", () => api);
vi.mock("../components/PageHeader", () => ({
  PageHeader: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));
vi.mock("../context/RealtimeContext", () => ({ useRealtimeVersion: () => 0 }));
vi.mock("../utils/csv", async (orig) => ({ ...(await orig<typeof import("../utils/csv")>()), downloadCsv: vi.fn() }));

let id = 0;
const count = (productId: number, name: string, date: string, variance: number, over: object = {}) => ({
  id: ++id,
  entryDate: `${date}T00:00:00.000Z`,
  location: "ONLINE",
  shift: "NIGHT",
  systemRemainingStock: "100.00",
  manualCount: String(100 - variance),
  variance: String(variance),
  remarks: null,
  product: { id: productId, sku: `SKU${productId}`, name, category: "Sauces" },
  countedBy: { name: "Ana Cruz" },
  ...over,
});

beforeEach(() => {
  vi.clearAllMocks();
  Element.prototype.scrollIntoView = vi.fn();
  api.getVarianceReport.mockResolvedValue([
    count(1, "Soy Sauce", "2026-10-02", 5, { remarks: "Spoilage" }),
    count(1, "Soy Sauce", "2026-10-03", -2),
    count(2, "Vinegar", "2026-10-02", 1),
    count(3, "Rice", "2026-10-02", 0),
  ]);
});

const open = () =>
  render(
    <MemoryRouter>
      <VarianceLedgerPage />
    </MemoryRouter>,
  );

describe("VarianceLedgerPage", () => {
  it("asks for every count, not just the off ones, over the chosen range", async () => {
    open();
    await screen.findByText("Soy Sauce");
    expect(api.getVarianceReport).toHaveBeenCalledWith(expect.objectContaining({ flaggedOnly: false, startDate: expect.any(String), endDate: expect.any(String) }));
  });

  it("lists the SKUs that were off, worst first, and tags a recurring one", async () => {
    open();
    await screen.findByText("Soy Sauce");
    expect(screen.queryByText("Rice")).toBeNull();
    const names = screen.getAllByText(/Soy Sauce|Vinegar/).map((n) => n.textContent);
    expect(names[0]).toContain("Soy Sauce");
    expect(screen.getByText("Recurring")).toBeTruthy();
  });

  it("can show every counted SKU", async () => {
    open();
    await screen.findByText("Soy Sauce");
    fireEvent.click(screen.getAllByRole("button", { name: /Show/i })[0]);
    fireEvent.click(await screen.findByRole("option", { name: "Every counted SKU" }));
    expect(await screen.findByText("Rice")).toBeTruthy();
  });

  it("opens a row to the counts behind it, with the reason or its absence", async () => {
    open();
    fireEvent.click((await screen.findByText("Soy Sauce")).closest("tr")!);
    expect(await screen.findByText("Spoilage")).toBeTruthy();
    expect(screen.getByText("No reason recorded")).toBeTruthy();
  });

  it("says so when nothing was counted in the period", async () => {
    api.getVarianceReport.mockResolvedValue([]);
    open();
    expect(await screen.findByText(/No manual counts were saved in this period/)).toBeTruthy();
  });

  it("surfaces a failed load", async () => {
    api.getVarianceReport.mockRejectedValue(new Error("Choose a range of at most 366 days"));
    open();
    await waitFor(() => expect(screen.getByText(/at most 366 days/)).toBeTruthy());
  });
});
