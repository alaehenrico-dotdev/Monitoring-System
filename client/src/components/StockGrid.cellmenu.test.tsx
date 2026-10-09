import { describe, expect, it, vi } from "vitest";
import { fireEvent, render } from "@testing-library/react";
import type { Product } from "../types";
import { StockGrid, type GridColumn, type GridRow } from "./StockGrid";

const columns: GridColumn[] = [
  { key: "openingStock", label: "Opening", editable: false },
  { key: "stockIn", label: "Stocks In", editable: true, tone: "in" },
  { key: "remainingStock", label: "Remaining", editable: false },
];

function rows(count = 3): GridRow[] {
  return Array.from({ length: count }, (_, i) => ({
    product: {
      id: i + 1,
      sku: `AFP00${i + 1}`,
      name: `Product ${i + 1}`,
      category: "Sauces",
    } as Product,
    entry: { id: 100 + i, openingStock: 10, stockIn: 4, remainingStock: 14 },
  }));
}

function renderGrid(extra: Record<string, unknown> = {}) {
  const onCommitMany = vi.fn();
  const result = render(
    <StockGrid
      rows={rows()}
      columns={columns}
      onCommit={vi.fn()}
      onCommitMany={onCommitMany}
      getSavedValue={() => 0}
      historyTable="daily_online_stock"
      {...extra}
    />,
  );
  return { ...result, onCommitMany };
}

const menu = () => document.querySelector('[role="menu"]');
const menuItems = () =>
  [...document.querySelectorAll<HTMLButtonElement>('[role="menuitem"]')];
const itemNamed = (label: string) =>
  menuItems().find((b) => b.textContent === label);
/// fireEvent (not el.click()) so React flushes the resulting state update
/// before the assertion - the menu is portaled outside the render container.
const pick = (label: string) => fireEvent.click(itemNamed(label)!);

function cell(container: HTMLElement, key: string): HTMLInputElement {
  const el = container.querySelector<HTMLInputElement>(`[data-cell="${key}"]`);
  if (!el) throw new Error(`no cell ${key}`);
  return el;
}

describe("StockGrid cell context menu", () => {
  it("opens on an editable cell", () => {
    const { container } = renderGrid();
    fireEvent.contextMenu(cell(container, "1:stockIn"));

    expect(menu()).not.toBeNull();
    expect(menuItems().map((b) => b.textContent)).toEqual([
      "View history",
      "Set to 0",
      "Copy value down",
    ]);
  });

  it("never opens on a calculated cell - those are not inputs at all", () => {
    const { container } = renderGrid();
    expect(container.querySelector('[data-cell="1:openingStock"]')).toBeNull();
    expect(container.querySelector('[data-cell="1:remainingStock"]')).toBeNull();
  });

  it("offers no cell menu on a read-only grid", () => {
    const { container } = render(
      <StockGrid
        rows={rows()}
        columns={columns}
        onCommit={vi.fn()}
        historyTable="daily_online_stock"
        readOnly
      />,
    );
    expect(container.querySelector('[data-cell="1:stockIn"]')).toBeNull();
    expect(menu()).toBeNull();
  });

  it("opens from Shift+F10 and the ContextMenu key on a focused cell", () => {
    const { container } = renderGrid();

    fireEvent.keyDown(cell(container, "1:stockIn"), { key: "F10", shiftKey: true });
    expect(menu()).not.toBeNull();
    fireEvent.keyDown(document.querySelector('[role="menu"]')!, { key: "Escape" });

    fireEvent.keyDown(cell(container, "1:stockIn"), { key: "ContextMenu" });
    expect(menu()).not.toBeNull();
  });

  it("names the product and column it belongs to", () => {
    const { container } = renderGrid();
    fireEvent.contextMenu(cell(container, "2:stockIn"));

    expect(menu()?.getAttribute("aria-label")).toBe(
      "Product 2 - Stocks In cell options",
    );
  });

  it("'Set to 0' stages a single edit through the batch handler", () => {
    const { container, onCommitMany } = renderGrid();
    fireEvent.contextMenu(cell(container, "2:stockIn"));
    pick("Set to 0");

    expect(onCommitMany).toHaveBeenCalledWith([
      { productId: 2, key: "stockIn", value: 0 },
    ]);
  });

  it("'Set to 0' is disabled on a cell already at zero", () => {
    const zeroed = rows();
    zeroed[0].entry.stockIn = 0;
    const { container } = renderGrid({ rows: zeroed });
    fireEvent.contextMenu(cell(container, "1:stockIn"));

    expect(itemNamed("Set to 0")).toBeDisabled();
  });

  it("'Copy value down' fills every row below, as one undo step", () => {
    const { container, onCommitMany } = renderGrid();
    fireEvent.contextMenu(cell(container, "1:stockIn"));
    pick("Copy value down");

    expect(onCommitMany).toHaveBeenCalledTimes(1);
    expect(onCommitMany).toHaveBeenCalledWith([
      { productId: 2, key: "stockIn", value: 4 },
      { productId: 3, key: "stockIn", value: 4 },
    ]);
  });

  it("'Copy value down' is disabled on the last row", () => {
    const { container } = renderGrid();
    fireEvent.contextMenu(cell(container, "3:stockIn"));

    expect(itemNamed("Copy value down")).toBeDisabled();
  });

  it("offers only 'View history' when the page wired no batch handler", () => {
    const { container } = render(
      <StockGrid
        rows={rows()}
        columns={columns}
        onCommit={vi.fn()}
        historyTable="daily_online_stock"
      />,
    );
    fireEvent.contextMenu(cell(container, "1:stockIn"));

    expect(menuItems().map((b) => b.textContent)).toEqual(["View history"]);
  });

  it("disables 'View history' on a grid with no change-log table", () => {
    const { container } = renderGrid({ historyTable: undefined });
    fireEvent.contextMenu(cell(container, "1:stockIn"));

    expect(itemNamed("View history")).toBeDisabled();
  });

  it("opens the history popover, and closes it on Escape", () => {
    const { container } = renderGrid();
    fireEvent.contextMenu(cell(container, "1:stockIn"));
    pick("View history");

    const popover = document.querySelector('[role="dialog"]');
    expect(popover?.getAttribute("aria-label")).toContain("Product 1");
    fireEvent.keyDown(popover!, { key: "Escape" });
    expect(document.querySelector('[role="dialog"]')).toBeNull();
  });

  it("leaves the column header's own menu untouched", () => {
    const { container } = renderGrid({
      onAddExtraColumns: vi.fn(),
      onRemoveExtraColumns: vi.fn(),
    });
    const th = [...container.querySelectorAll("th")].find((el) =>
      el.textContent?.startsWith("Stocks In"),
    )!;
    fireEvent.contextMenu(th);

    expect(menuItems().map((b) => b.textContent)).toContain("Add column: +1");
  });
});
