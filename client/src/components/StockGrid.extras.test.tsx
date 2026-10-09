import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import type { Product } from "../types";
import { StockGrid, type GridColumn, type GridRow } from "./StockGrid";
import {
  extraColumnKey,
  MAX_EXTRAS_PER_COLUMN,
} from "../hooks/useExtraColumns";
import { offlineStockColumns } from "../config/stockColumns";

const columns: GridColumn[] = [
  { key: "openingStock", label: "Opening", editable: false },
  { key: "stockIn", label: "Stocks In", editable: true, tone: "in" },
  { key: "remainingStock", label: "Remaining", editable: false },
];

function rows(count = 2): GridRow[] {
  return Array.from({ length: count }, (_, i) => ({
    product: {
      id: i + 1,
      sku: `AFP00${i + 1}`,
      name: `Product ${i + 1}`,
      category: "Sauces",
    } as Product,
    entry: { openingStock: 10, stockIn: 4, remainingStock: 14 },
  }));
}

function renderGrid(extra: Record<string, unknown> = {}) {
  return render(
    <StockGrid
      rows={rows()}
      columns={columns}
      onCommit={vi.fn()}
      onAddExtraColumns={vi.fn()}
      onRemoveExtraColumns={vi.fn()}
      {...extra}
    />,
  );
}

function headerFor(
  container: HTMLElement,
  label: string,
): HTMLTableCellElement {
  const th = [...container.querySelectorAll("th")].find((el) =>
    el.textContent?.startsWith(label),
  );
  if (!th) throw new Error(`no header for ${label}`);
  return th as HTMLTableCellElement;
}

const menu = () => document.querySelector('[role="menu"]');
const menuItems = () => [
  ...document.querySelectorAll<HTMLButtonElement>('[role="menuitem"]'),
];

describe("StockGrid extra-column header menu", () => {
  it("opens only on editable headers, and never on calculated ones", () => {
    const { container } = renderGrid();

    fireEvent.contextMenu(headerFor(container, "Opening"));
    expect(menu()).toBeNull();
    fireEvent.contextMenu(headerFor(container, "Remaining"));
    expect(menu()).toBeNull();

    fireEvent.contextMenu(headerFor(container, "Stocks In"));
    expect(menu()).not.toBeNull();
  });

  it("offers no menu at all on a read-only grid", () => {
    const { container } = render(
      <StockGrid rows={rows()} columns={columns} onCommit={vi.fn()} readOnly />,
    );
    fireEvent.contextMenu(headerFor(container, "Stocks In"));
    expect(menu()).toBeNull();
  });

  it("opens from the keyboard with Shift+F10 and the ContextMenu key", () => {
    const { container } = renderGrid();
    const th = headerFor(container, "Stocks In");
    expect(th.tabIndex).toBe(0);

    fireEvent.keyDown(th, { key: "F10", shiftKey: true });
    expect(menu()).not.toBeNull();
    fireEvent.keyDown(menu()!, { key: "Escape" });
    expect(menu()).toBeNull();

    fireEvent.keyDown(th, { key: "ContextMenu" });
    expect(menu()).not.toBeNull();
  });

  it("asks for +1, +2 and +5 columns and closes on the choice", () => {
    const onAddExtraColumns = vi.fn();
    const { container } = renderGrid({ onAddExtraColumns });

    for (const [i, count] of [1, 2, 5].entries()) {
      fireEvent.contextMenu(headerFor(container, "Stocks In"));
      fireEvent.click(menuItems()[i]);
      expect(onAddExtraColumns).toHaveBeenLastCalledWith("stockIn", count);
      expect(menu()).toBeNull();
    }
  });

  it("runs the focused item on Enter after arrow-key navigation", () => {
    const onAddExtraColumns = vi.fn();
    const { container } = renderGrid({ onAddExtraColumns });
    fireEvent.contextMenu(headerFor(container, "Stocks In"));
    fireEvent.keyDown(menu()!, { key: "ArrowDown" });
    fireEvent.keyDown(menu()!, { key: "Enter" });
    expect(onAddExtraColumns).toHaveBeenCalledWith("stockIn", 2);
  });

  it("lists delete items only once the column has added columns", () => {
    const { container, rerender } = renderGrid();
    fireEvent.contextMenu(headerFor(container, "Stocks In"));
    expect(menuItems()).toHaveLength(3);
    fireEvent.keyDown(menu()!, { key: "Escape" });

    const onRemoveExtraColumns = vi.fn();
    rerender(
      <StockGrid
        rows={rows()}
        columns={columns}
        onCommit={vi.fn()}
        onAddExtraColumns={vi.fn()}
        onRemoveExtraColumns={onRemoveExtraColumns}
        extraColumns={{ stockIn: [1, 2] }}
      />,
    );
    fireEvent.contextMenu(headerFor(container, "Stocks In"));
    const items = menuItems();
    expect(items).toHaveLength(5);
    fireEvent.click(items[4]);
    expect(onRemoveExtraColumns).toHaveBeenCalledWith("stockIn", [1, 2]);
  });

  it("disables adding once the cap is reached", () => {
    const full = Array.from({ length: MAX_EXTRAS_PER_COLUMN }, (_, i) => i + 1);
    const { container } = renderGrid({ extraColumns: { stockIn: full } });
    fireEvent.contextMenu(headerFor(container, "Stocks In"));
    const items = menuItems();
    expect(items.slice(0, 3).every((b) => b.disabled)).toBe(true);
    // Deleting is still offered - the cap is only on adding.
    expect(items.slice(3).every((b) => b.disabled)).toBe(false);
  });
});

describe("StockGrid extra columns", () => {
  it("renders one input per added column and locks the main column", () => {
    const { container } = renderGrid({ extraColumns: { stockIn: [1, 3] } });

    expect(container.querySelector(`input[data-cell="1:stockIn"]`)).toBeNull();
    for (const slot of [1, 3]) {
      const key = extraColumnKey("stockIn", slot);
      expect(
        container.querySelector(`input[data-cell="1:${key}"]`),
      ).not.toBeNull();
      expect(
        container.querySelector(`input[data-cell="2:${key}"]`),
      ).not.toBeNull();
    }
    // The main column still shows its (now read-only) figure, which the
    // totals, Remaining Stock and % column all go on reading.
    expect(container.textContent).toContain("Remaining");
  });

  it("steps through the added columns with the arrow keys", () => {
    const { container } = renderGrid({ extraColumns: { stockIn: [1, 2] } });
    const cell = (id: string) =>
      container.querySelector<HTMLInputElement>(`input[data-cell="${id}"]`)!;
    const first = cell(`1:${extraColumnKey("stockIn", 1)}`);
    first.focus();
    fireEvent.keyDown(first, { key: "ArrowRight" });
    expect(document.activeElement).toBe(
      cell(`1:${extraColumnKey("stockIn", 2)}`),
    );
  });

  it("deletes one added column from the x in its header", () => {
    const onRemoveExtraColumns = vi.fn();
    const { container } = renderGrid({
      extraColumns: { stockIn: [1, 2] },
      onRemoveExtraColumns,
    });
    const del = container.querySelectorAll<HTMLButtonElement>(
      "button.ae-added-col-del",
    );
    expect(del).toHaveLength(2);
    fireEvent.click(del[1]);
    expect(onRemoveExtraColumns).toHaveBeenCalledWith("stockIn", [2]);
  });

  it("totals each added column in the subtotal and grand total rows", () => {
    const key = extraColumnKey("stockIn", 1);
    const withValues: GridRow[] = [
      {
        product: { id: 1, sku: "A", name: "A", category: "Sauces" } as Product,
        entry: { openingStock: 0, stockIn: 7, remainingStock: 0, [key]: 7 },
      },
      {
        product: { id: 2, sku: "B", name: "B", category: "Sauces" } as Product,
        entry: { openingStock: 0, stockIn: 5, remainingStock: 0, [key]: 5 },
      },
    ];
    const { container } = render(
      <StockGrid
        rows={withValues}
        columns={columns}
        onCommit={vi.fn()}
        onAddExtraColumns={vi.fn()}
        onRemoveExtraColumns={vi.fn()}
        extraColumns={{ stockIn: [1] }}
      />,
    );
    const grand = container.querySelector("tr.ae-row-grand")!;
    // The main column's 12 and its single added column's 12, side by side.
    expect(
      [...grand.querySelectorAll("td")].map((td) => td.textContent),
    ).toContain("12");
    const subtotal = container.querySelector("tr.ae-row-subtotal")!;
    expect(
      [...subtotal.querySelectorAll("td.ae-extra-col")].map(
        (td) => td.textContent,
      ),
    ).toEqual(["12"]);
  });
});

describe("Delivery (Out) uses the same added-column mechanism", () => {
  it("is an ordinary editable column, with no fixed sub-columns of its own", () => {
    const delivery = offlineStockColumns.find((c) => c.key === "deliveryOut")!;
    expect(delivery.editable).toBe(true);
    // The five fixed "Delivery 1..5" columns behind a header arrow are gone -
    // it is broken down through the header menu like every other column now.
    expect("subColumns" in delivery).toBe(false);
    expect(offlineStockColumns.some((c) => c.key === "delivery1")).toBe(false);
  });

  it("offers the add-column menu on its header", () => {
    const { container } = render(
      <StockGrid
        rows={[
          {
            product: {
              id: 1,
              sku: "A",
              name: "A",
              category: "Sauces",
            } as Product,
            entry: { deliveryOut: 25 },
          },
        ]}
        columns={offlineStockColumns}
        onCommit={vi.fn()}
        onAddExtraColumns={vi.fn()}
        onRemoveExtraColumns={vi.fn()}
      />,
    );
    fireEvent.contextMenu(headerFor(container, "Delivery (Out)"));
    expect(menu()).not.toBeNull();
    expect(menuItems().map((b) => b.textContent)).toEqual([
      "Add column: +1",
      "Add column: +2",
      "Add column: +5",
    ]);
  });

  it("names an added column per browser, the way the fixed Delivery columns were nameable", () => {
    const { container } = renderGrid({ extraColumns: { stockIn: [1] } });
    const name = container.querySelector<HTMLInputElement>(
      "th .ae-extra-head-input",
    )!;
    expect(name.placeholder).toBe("+1");
    fireEvent.change(name, { target: { value: "Batangas run" } });
    expect(name.value).toBe("Batangas run");
    // A label only - never part of the saved entry.
    expect(localStorage.getItem("ala-eh-grid-subcolumn-names")).toContain(
      "Batangas run",
    );
  });
});

describe("StockGrid header color picker", () => {
  beforeEach(() => localStorage.clear());

  it("recolors the header (and persists it) from the right-click menu", () => {
    const { container } = renderGrid();
    fireEvent.contextMenu(headerFor(container, "Stocks In"));
    fireEvent.click(
      screen.getByRole("button", { name: /header color to #F6E58D/i }),
    );
    expect(headerFor(container, "Stocks In").style.background).toMatch(
      /f6e58d|246, 229, 141/i,
    );
    expect(localStorage.getItem("ala-eh-grid-column-colors")).toContain(
      "#f6e58d",
    );
  });

  it("resets back to the default tone", () => {
    const { container } = renderGrid();
    fireEvent.contextMenu(headerFor(container, "Stocks In"));
    fireEvent.click(
      screen.getByRole("button", { name: /header color to #F6E58D/i }),
    );
    fireEvent.contextMenu(headerFor(container, "Stocks In"));
    fireEvent.click(screen.getByRole("menuitem", { name: "Reset color" }));
    expect(localStorage.getItem("ala-eh-grid-column-colors")).not.toContain(
      "f6e58d",
    );
  });
});

describe("StockGrid category row color", () => {
  beforeEach(() => localStorage.clear());

  const catButton = (container: HTMLElement) =>
    container.querySelector<HTMLButtonElement>(".ae-cat-toggle")!;

  it("recolors a category row from its right-click menu and can reset it", () => {
    const { container } = renderGrid();
    fireEvent.contextMenu(catButton(container));
    fireEvent.click(
      screen.getByRole("button", { name: /category color to #A8E6A1/i }),
    );
    expect(catButton(container).style.background).toMatch(
      /a8e6a1|168, 230, 161/i,
    );
    expect(localStorage.getItem("ala-eh-grid-category-colors")).toContain(
      "#a8e6a1",
    );

    fireEvent.contextMenu(catButton(container));
    fireEvent.click(screen.getByRole("menuitem", { name: "Reset color" }));
    expect(catButton(container).style.background).toBe("");
  });
});
