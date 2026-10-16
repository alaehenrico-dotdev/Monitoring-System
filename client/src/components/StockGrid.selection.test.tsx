import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import type { Product } from "../types";
import { StockGrid, type GridColumn, type GridRow } from "./StockGrid";

const columns: GridColumn[] = [
  { key: "openingStock", label: "Opening", editable: false },
  { key: "stockIn", label: "Stocks In", editable: true, tone: "in" },
  { key: "remainingStock", label: "Remaining", editable: false },
];

function rows(count = 5): GridRow[] {
  return Array.from({ length: count }, (_, i) => ({
    product: { id: i + 1, sku: `AFP00${i + 1}`, name: `Product ${i + 1}`, category: i < 4 ? "Sauces" : "Oils" } as Product,
    entry: { id: 100 + i, openingStock: 10, stockIn: i + 1, remainingStock: 10 + i + 1 },
  }));
}

function renderGrid(extra: Record<string, unknown> = {}) {
  const onCommitMany = vi.fn();
  const result = render(
    <StockGrid rows={rows()} columns={columns} onCommit={vi.fn()} onCommitMany={onCommitMany} getSavedValue={() => 0} {...extra} />,
  );
  // Categories start collapsed; only rows on screen can be selected.
  fireEvent.click(screen.getByRole("button", { name: /^Sauces/ }));
  fireEvent.click(screen.getByRole("button", { name: /^Oils/ }));
  return { ...result, onCommitMany };
}

afterEach(cleanup);

const nameCell = (n: number) => screen.getByText(`Product ${n}`);
const press = (n: number, mods: Record<string, boolean> = {}) => fireEvent.mouseDown(nameCell(n), { button: 0, ...mods });
const rowOf = (n: number) => nameCell(n).closest("tr")!;
const selectedNames = () =>
  [...document.querySelectorAll("tr.ae-row-selected .ae-cell-name")].map((td) => td.textContent);
const bar = () => screen.queryByRole("toolbar", { name: "Selected rows" });

describe("StockGrid row selection", () => {
  it("selects a row on click and shows what can be done with it", () => {
    renderGrid();
    expect(bar()).toBeNull();

    press(2);

    expect(selectedNames()).toEqual(["Product 2"]);
    expect(within(bar()!).getByText("1 row selected")).toBeTruthy();
  });

  it("Shift+click selects the range from the anchor, across categories", () => {
    renderGrid();
    press(2);
    press(5, { shiftKey: true });
    expect(selectedNames()).toEqual(["Product 2", "Product 3", "Product 4", "Product 5"]);
    press(3, { shiftKey: true });
    expect(selectedNames()).toEqual(["Product 2", "Product 3"]);
  });

  it("Ctrl+click adds and removes single rows", () => {
    renderGrid();
    press(1);
    press(3, { ctrlKey: true });
    press(5, { metaKey: true });
    expect(selectedNames()).toEqual(["Product 1", "Product 3", "Product 5"]);
    press(3, { ctrlKey: true });
    expect(selectedNames()).toEqual(["Product 1", "Product 5"]);
  });

  it("dragging over rows selects them", () => {
    renderGrid();
    press(2);
    fireEvent.mouseEnter(nameCell(4));
    expect(selectedNames()).toEqual(["Product 2", "Product 3", "Product 4"]);
    fireEvent.mouseUp(window);
    fireEvent.mouseEnter(nameCell(5));
    expect(selectedNames()).toEqual(["Product 2", "Product 3", "Product 4"]);
  });

  it("shows the selected rows' totals per column", () => {
    renderGrid();
    press(2);
    press(3, { shiftKey: true }); // stockIn 2 + 3, remaining 12 + 13
    const totals = document.querySelector("tr.ae-row-selected-total")!;
    expect(totals.textContent).toContain("SELECTED (2)");
    const cells = [...totals.querySelectorAll("td")].map((td) => td.textContent);
    expect(cells).toEqual(["SELECTED (2)", "20", "5", "25"]);
  });

  it("keeps a collapsed category's rows out of the selection", () => {
    renderGrid();
    press(1);
    press(5, { ctrlKey: true });
    expect(selectedNames()).toEqual(["Product 1", "Product 5"]);

    fireEvent.click(screen.getByRole("button", { name: /^Oils/ }));

    expect(within(bar()!).getByText("1 row selected")).toBeTruthy();
  });

  it("Escape clears the selection", () => {
    renderGrid();
    press(1);
    fireEvent.keyDown(document.body, { key: "Escape" });
    expect(bar()).toBeNull();
  });

  it("fills one value into a column of every selected row, as one batch", () => {
    const { onCommitMany } = renderGrid();
    press(1);
    press(3, { shiftKey: true });

    fireEvent.change(screen.getByLabelText("Value to fill"), { target: { value: "7" } });
    fireEvent.click(screen.getByRole("button", { name: "Fill" }));

    expect(onCommitMany).toHaveBeenCalledTimes(1);
    expect(onCommitMany).toHaveBeenCalledWith([
      { productId: 1, key: "stockIn", value: 7 },
      { productId: 2, key: "stockIn", value: 7 },
      { productId: 3, key: "stockIn", value: 7 },
    ]);
  });

  it("won't fill a negative or empty value", () => {
    renderGrid();
    press(1);
    const fill = screen.getByRole("button", { name: "Fill" }) as HTMLButtonElement;
    expect(fill.disabled).toBe(true);
    fireEvent.change(screen.getByLabelText("Value to fill"), { target: { value: "-3" } });
    expect(fill.disabled).toBe(true);
  });

  it("Clear cells and the Delete key zero every editable cell of the selected rows", () => {
    const { onCommitMany } = renderGrid();
    press(2);
    press(3, { ctrlKey: true });

    fireEvent.click(screen.getByRole("button", { name: "Clear cells" }));
    expect(onCommitMany).toHaveBeenLastCalledWith([
      { productId: 2, key: "stockIn", value: 0 },
      { productId: 3, key: "stockIn", value: 0 },
    ]);

    fireEvent.keyDown(document.body, { key: "Delete" });
    expect(onCommitMany).toHaveBeenCalledTimes(2);
  });

  it("leaves Delete alone while typing in a cell", () => {
    const { onCommitMany, container } = renderGrid();
    press(2);
    fireEvent.keyDown(container.querySelector('[data-cell="2:stockIn"]')!, { key: "Delete" });
    expect(onCommitMany).not.toHaveBeenCalled();
  });

  it("copies the selected rows as tab-separated text for Excel", () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
    renderGrid();
    press(1);
    press(3, { ctrlKey: true });

    fireEvent.keyDown(document.body, { key: "c", ctrlKey: true });

    expect(writeText).toHaveBeenCalledWith(
      ["SKU\tProduct\tOpening\tStocks In\tRemaining", "AFP001\tProduct 1\t10\t1\t11", "AFP003\tProduct 3\t10\t3\t13"].join("\n"),
    );
  });

  it("on a read-only grid it can copy but not fill or clear", () => {
    renderGrid({ readOnly: true, onCommitMany: undefined, getSavedValue: undefined });
    press(1);
    expect(screen.getByRole("button", { name: "Copy" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Fill" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Clear cells" })).toBeNull();
  });

  it("only the clicked row is highlighted", () => {
    renderGrid();
    press(2);
    expect(rowOf(2).classList.contains("ae-row-selected")).toBe(true);
    expect(rowOf(3).classList.contains("ae-row-selected")).toBe(false);
  });
});
