import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { TotalStockRow } from "../types";
import { TotalStocksTable } from "./TotalStocksTable";

const row = (id: number, name: string, category: string, online: number, offline: number): TotalStockRow =>
  ({
    product: { id, sku: `SKU${id}`, name, category, unit: "pc", isActive: true, sortOrder: id, lowStockThreshold: null },
    onlineRemainingStock: online,
    offlineRemainingStock: offline,
    totalRemainingStock: online + offline,
    totalManualCount: null,
    totalVariance: null,
  }) as unknown as TotalStockRow;

const rows = [row(1, "Soy Sauce", "Sauces", 10, 5), row(2, "Vinegar", "Sauces", 20, 1), row(3, "Rice", "Grains", 7, 7)];

afterEach(cleanup);

function open() {
  render(<TotalStocksTable rows={rows} />);
  fireEvent.click(screen.getByRole("button", { name: /^Sauces/ }));
  fireEvent.click(screen.getByRole("button", { name: /^Grains/ }));
}
const press = (name: string, mods: Record<string, boolean> = {}) => fireEvent.mouseDown(screen.getByText(name), { button: 0, ...mods });
const selectedNames = () => [...document.querySelectorAll("tr.ae-row-selected .ae-cell-name")].map((td) => td.textContent);

describe("TotalStocksTable - selecting rows", () => {
  it("Shift+click selects a range and totals each column for it", () => {
    open();
    press("Soy Sauce");
    press("Rice", { shiftKey: true });

    expect(selectedNames()).toEqual(["Soy Sauce", "Vinegar", "Rice"]);
    const cells = [...document.querySelectorAll("tr.ae-row-selected-total td")].map((td) => td.textContent);
    expect(cells).toEqual(["SELECTED (3)", "37", "13", "50"]);
  });

  it("a range across categories never includes a category bar, subtotal or the grand total", () => {
    open();
    press("Soy Sauce");
    press("Rice", { shiftKey: true });

    const rows = [...document.querySelectorAll("tr.ae-row-selected")];
    expect(rows).toHaveLength(3);
    expect(rows.every((tr) => tr.classList.contains("ae-cat-row") && !tr.querySelector(".ae-cat-toggle"))).toBe(true);
    expect(document.querySelector(".ae-table--pickable")).not.toBeNull();
    fireEvent.mouseDown(screen.getByText("GRAND TOTAL"), { button: 0, shiftKey: true });
    expect(document.querySelectorAll("tr.ae-row-selected")).toHaveLength(3);
  });

  it("Ctrl+click adds and removes rows", () => {
    open();
    press("Soy Sauce");
    press("Rice", { ctrlKey: true });
    expect(selectedNames()).toEqual(["Soy Sauce", "Rice"]);
    press("Rice", { ctrlKey: true });
    expect(selectedNames()).toEqual(["Soy Sauce"]);
  });

  it("is read-only: Copy only, no fill or clear", () => {
    open();
    press("Vinegar");
    expect(screen.getByRole("button", { name: "Copy" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Fill" })).toBeNull();
    expect(screen.queryByRole("button", { name: /Clear (cells|counts)/ })).toBeNull();
  });

  it("copies the selected rows for Excel", () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
    open();
    press("Soy Sauce");
    press("Rice", { ctrlKey: true });

    fireEvent.keyDown(document.body, { key: "c", ctrlKey: true });

    expect(writeText).toHaveBeenCalledWith(
      ["SKU\tProduct\tOnline Remaining\tOffline Remaining\tConsolidated Remaining", "SKU1\tSoy Sauce\t10\t5\t15", "SKU3\tRice\t7\t7\t14"].join("\n"),
    );
  });
});
