import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ReactNode } from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { ManualCountPage } from "./ManualCountPage";

const api = vi.hoisted(() => ({ getManualCountGrid: vi.fn(), saveManualCount: vi.fn(), getVarianceTrace: vi.fn(), setCountRemarks: vi.fn(), publishManualCounts: vi.fn() }));
vi.mock("../context/AuthContext", () => ({ useAuth: () => ({ user: { id: 1, name: "Sup", username: "sup", role: "SUPERVISOR_ADMIN" } }) }));
vi.mock("../api/manualCounts", () => api);
vi.mock("../api/reportHistory", () => ({ recordReportHistory: vi.fn().mockResolvedValue({}) }));
vi.mock("../components/PageHeader", () => ({ PageHeader: ({ children }: { children: ReactNode }) => <div>{children}</div> }));
vi.mock("../components/CsvTools", () => ({ CsvTools: () => null }));
vi.mock("../hooks/useTopProgress", () => ({ useTopProgress: () => ({ start: vi.fn(), done: vi.fn() }) }));
vi.mock("../context/RealtimeContext", () => ({ useRealtimeVersion: () => 0 }));

const row = (id: number, name: string, category: string, loc: "ONLINE" | "OFFLINE", system: number, count: number | null) => ({
  product: { id, sku: `SKU${id}`, name, category, unit: "pc", isActive: true, sortOrder: id },
  entry: {
    productId: id, entryDate: "2026-10-09", shift: "NIGHT", location: loc,
    systemRemainingStock: system, manualCount: count, variance: count === null ? null : system - count,
  },
  isSaved: count !== null,
  isFlagged: count !== null && system !== count,
});

beforeEach(() => {
  vi.clearAllMocks();
  sessionStorage.clear();
  Element.prototype.scrollIntoView = vi.fn();
  api.getManualCountGrid.mockImplementation((_d: string, _s: string, loc: "ONLINE" | "OFFLINE") =>
    Promise.resolve([
      row(1, "Soy Sauce", "Sauces", loc, 10, loc === "ONLINE" ? 8 : null),
      row(2, "Vinegar", "Sauces", loc, 5, loc === "ONLINE" ? 5 : null),
      row(3, "Rice", "Grains", loc, 4, null),
    ]),
  );
});
afterEach(cleanup);

async function open() {
  render(
    <MemoryRouter>
      <ManualCountPage />
    </MemoryRouter>,
  );
  await screen.findByText("Sauces");
  // Categories start collapsed; only rows on screen can be selected.
  fireEvent.click(screen.getAllByRole("button", { name: "Expand every category" })[0]);
}

const press = (name: string, mods: Record<string, boolean> = {}) => fireEvent.mouseDown(screen.getByText(name), { button: 0, ...mods });
const selectedNames = () => [...document.querySelectorAll("tr.ae-row-selected .ae-cell-name")].map((td) => td.textContent);
const bar = () => screen.queryByRole("toolbar", { name: "Selected rows" });
const countInput = (loc: "ONLINE" | "OFFLINE", id: number) => document.querySelector<HTMLInputElement>(`[data-cell="manual-count-${loc}-${id}"]`)!;

/// Whatever a range spans, only product rows are selected: never a category bar, a
/// subtotal or the grand total - and none of them is a place to start a selection.
const selectedRowsAreProductRows = () => {
  const rows = [...document.querySelectorAll("tr.ae-row-selected")];
  return rows.length > 0 && rows.every((tr) => tr.classList.contains("ae-cat-row") && !tr.querySelector(".ae-cat-toggle"));
};

describe("ManualCountPage - selecting rows", () => {
  it("Shift+click selects a range across categories and shows its totals", async () => {
    await open();
    press("Soy Sauce");
    press("Rice", { shiftKey: true });

    expect(selectedNames()).toEqual(["Soy Sauce", "Vinegar", "Rice"]);
    expect(bar()!.textContent).toContain("3 rows selected");
    // System remaining adds Online + Offline for each row: 20 + 10 + 8.
    const totals = document.querySelector("tr.ae-row-selected-total")!;
    expect(totals.textContent).toContain("SELECTED (3)");
    expect(totals.querySelectorAll("td")[1].textContent).toBe("38");
  });

  it("a range across categories never includes a category bar, subtotal or the grand total", async () => {
    await open();
    press("Soy Sauce");
    press("Rice", { shiftKey: true });

    expect(selectedRowsAreProductRows()).toBe(true);
    expect(document.querySelectorAll("tr.ae-row-selected")).toHaveLength(3); // 3 products, not the bars/subtotals between them
    expect(document.querySelector(".ae-table--pickable")).not.toBeNull(); // so the browser's own text highlight cannot paint across them
    // Pressing a category bar or a subtotal does not start or change a selection.
    fireEvent.mouseDown(screen.getByText("Subtotal - Sauces"), { button: 0, shiftKey: true });
    expect(document.querySelectorAll("tr.ae-row-selected")).toHaveLength(3);
  });

  it("Ctrl+click adds and removes single rows", async () => {
    await open();
    press("Soy Sauce");
    press("Rice", { ctrlKey: true });
    expect(selectedNames()).toEqual(["Soy Sauce", "Rice"]);
    press("Soy Sauce", { ctrlKey: true });
    expect(selectedNames()).toEqual(["Rice"]);
  });

  it("fills one count into a column of every selected row, as unsaved drafts", async () => {
    await open();
    press("Soy Sauce");
    press("Vinegar", { shiftKey: true });

    fireEvent.change(screen.getByLabelText("Column to fill"), { target: { value: "OFFLINE" } });
    fireEvent.change(screen.getByLabelText("Value to fill"), { target: { value: "7" } });
    fireEvent.click(screen.getByRole("button", { name: "Fill" }));

    expect(countInput("OFFLINE", 1).value).toBe("7");
    expect(countInput("OFFLINE", 2).value).toBe("7");
    expect(countInput("OFFLINE", 3).value).toBe(""); // not selected
    expect(countInput("ONLINE", 1).value).toBe("8"); // other column untouched
    expect(api.saveManualCount).not.toHaveBeenCalled();
  });

  it("Clear counts puts the selected rows back to uncounted, unsaved", async () => {
    await open();
    press("Soy Sauce");
    press("Vinegar", { ctrlKey: true });

    fireEvent.click(screen.getByRole("button", { name: "Clear counts" }));

    expect(countInput("ONLINE", 1).value).toBe("");
    expect(countInput("ONLINE", 2).value).toBe("");
    expect(api.saveManualCount).not.toHaveBeenCalled();
  });

  it("copies the selected rows with their live figures for Excel", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
    await open();
    press("Soy Sauce");
    press("Vinegar", { ctrlKey: true });

    fireEvent.keyDown(document.body, { key: "c", ctrlKey: true });

    expect(writeText).toHaveBeenCalledWith(
      [
        "SKU\tProduct\tSystem Remaining\tOffline Count\tOnline Count\tTotal Count\tVariance",
        "SKU1\tSoy Sauce\t20\t\t8\t8\t2",
        "SKU2\tVinegar\t10\t\t5\t5\t0",
      ].join("\n"),
    );
  });

  it("keeps a collapsed category's rows out of the selection, and Esc clears it", async () => {
    await open();
    press("Soy Sauce");
    press("Rice", { ctrlKey: true });
    fireEvent.click(screen.getByRole("button", { name: /^Grains/ })); // collapse Grains
    expect(bar()!.textContent).toContain("1 row selected");

    fireEvent.keyDown(document.body, { key: "Escape" });
    expect(bar()).toBeNull();
  });
});
