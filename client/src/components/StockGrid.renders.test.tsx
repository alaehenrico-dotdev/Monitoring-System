import { describe, expect, it, vi } from "vitest";
import { fireEvent, render } from "@testing-library/react";
import type { Product } from "../types";
import { StockGrid, type GridColumn, type GridRow } from "./StockGrid";

// Counts how many times a grid cell input function-component renders. Only
// the counting wrapper is swapped in - the real NumberCellInput still renders
// underneath, so the DOM the assertions below query is the real one.
const counter = vi.hoisted(() => ({ renders: 0 }));
vi.mock("./ui", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./ui")>();
  return {
    ...actual,
    NumberCellInput: (props: Parameters<typeof actual.NumberCellInput>[0]) => {
      counter.renders += 1;
      return actual.NumberCellInput(props);
    },
  };
});

const CATEGORIES = ["Sauces", "Vinegars", "Spices", "Oils"];
const ROWS = 60;

function makeRows(): GridRow[] {
  return Array.from({ length: ROWS }, (_, i) => {
    const product: Product = {
      id: i + 1,
      sku: `AFP${String(i + 1).padStart(3, "0")}`,
      name: `Product ${i + 1}`,
      category: CATEGORIES[i % CATEGORIES.length],
    } as Product;
    return { product, entry: { openingStock: 10, stockIn: 5, stockOut: 2 } };
  });
}

const columns: GridColumn[] = [
  { key: "openingStock", label: "Opening", editable: false },
  { key: "stockIn", label: "In", editable: true },
  { key: "stockOut", label: "Out", editable: true },
];

describe("StockGrid render cost", () => {
  it("typing in one cell re-renders only that cell, not the whole grid", () => {
    const rows = makeRows();
    const onCommit = vi.fn();
    const { container } = render(
      <StockGrid rows={rows} columns={columns} onCommit={onCommit} />,
    );

    const cells = container.querySelectorAll<HTMLInputElement>("input[data-cell]");
    expect(cells.length).toBe(ROWS * 2);

    counter.renders = 0;
    fireEvent.change(cells[0], { target: { value: "12" } });
    const afterOneKeystroke = counter.renders;

    // Report the number so before/after is visible in the test log.
    // eslint-disable-next-line no-console -- deliberate benchmark output, see comment above
    console.log(`cell renders for one keystroke: ${afterOneKeystroke} (grid has ${cells.length} editable cells)`);

    expect(cells[0].value).toBe("12");
    expect(afterOneKeystroke).toBeLessThanOrEqual(2);
  });

  it("commits the typed value on blur and shows the committed value again", () => {
    const rows = makeRows();
    const onCommit = vi.fn();
    const { container } = render(
      <StockGrid rows={rows} columns={columns} onCommit={onCommit} />,
    );
    const cell = container.querySelector<HTMLInputElement>('input[data-cell="1:stockIn"]')!;
    fireEvent.change(cell, { target: { value: "42" } });
    expect(cell.value).toBe("42");
    fireEvent.blur(cell);
    expect(onCommit).toHaveBeenCalledWith(1, "stockIn", 42);
    // No draft left behind: falls back to the row's own value.
    expect(cell.value).toBe("5");
  });

  it("keeps arrow-key and Enter navigation between cells working", () => {
    const { container } = render(
      <StockGrid rows={makeRows()} columns={columns} onCommit={vi.fn()} />,
    );
    const get = (id: string) =>
      container.querySelector<HTMLInputElement>(`input[data-cell="${id}"]`)!;

    get("1:stockIn").focus();
    fireEvent.keyDown(get("1:stockIn"), { key: "ArrowRight" });
    expect(document.activeElement).toBe(get("1:stockOut"));
    fireEvent.keyDown(get("1:stockOut"), { key: "ArrowLeft" });
    expect(document.activeElement).toBe(get("1:stockIn"));
    fireEvent.keyDown(get("1:stockIn"), { key: "ArrowDown" });
    expect(document.activeElement).toBe(get("2:stockIn"));
    fireEvent.keyDown(get("2:stockIn"), { key: "ArrowUp" });
    expect(document.activeElement).toBe(get("1:stockIn"));
    fireEvent.keyDown(get("1:stockIn"), { key: "Enter" });
    expect(document.activeElement).toBe(get("2:stockIn"));
  });

  it("commits through the latest onCommit even when the parent passes a new one", () => {
    const rows = makeRows();
    const first = vi.fn();
    const second = vi.fn();
    const { container, rerender } = render(
      <StockGrid rows={rows} columns={columns} onCommit={first} />,
    );
    rerender(<StockGrid rows={rows} columns={columns} onCommit={second} />);
    const cell = container.querySelector<HTMLInputElement>('input[data-cell="3:stockOut"]')!;
    fireEvent.change(cell, { target: { value: "7" } });
    fireEvent.blur(cell);
    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledWith(3, "stockOut", 7);
  });
});

describe("StockGrid display additions", () => {
  const readOnlyColumns: GridColumn[] = [
    { key: "openingStock", label: "Opening", editable: false },
    { key: "remainingStock", label: "Remaining", editable: false },
  ];

  function renderGrid(rows: GridRow[], extra: Record<string, unknown> = {}) {
    return render(
      <StockGrid
        rows={rows}
        columns={readOnlyColumns}
        onCommit={vi.fn()}
        readOnly
        {...extra}
      />,
    );
  }

  function row(id: number, category: string, entry: Record<string, unknown>): GridRow {
    return {
      product: { id, sku: `AFP00${id}`, name: `Product ${id}`, category } as Product,
      entry,
    };
  }

  it("draws a zero cell as a dash instead of 0", () => {
    const { container } = renderGrid([
      row(1, "Sauces", { openingStock: 0, remainingStock: 250 }),
    ]);
    const zeroCell = container.querySelector("td.ae-num-zero");
    expect(zeroCell?.textContent).toBe("\u2013");
  });

  it("keeps real values formatted with thousands separators", () => {
    const { container } = renderGrid([
      row(1, "Sauces", { openingStock: 1234, remainingStock: 250 }),
    ]);
    expect(container.textContent).toContain((1234).toLocaleString());
  });

  it("renders a % of total column only when asked for", () => {
    const rows = [
      row(1, "Sauces", { openingStock: 0, remainingStock: 250 }),
      row(2, "Sauces", { openingStock: 0, remainingStock: 750 }),
    ];
    const without = renderGrid(rows);
    expect(without.container.querySelector(".ae-pct-col")).toBeNull();
    without.unmount();

    const { container } = renderGrid(rows, {
      percentOfTotalKey: "remainingStock",
    });
    const pcts = [...container.querySelectorAll("td.ae-pct-col")].map(
      (el) => el.textContent,
    );
    // 250 and 750 of a 1000 total, then the category subtotal (100%) and the
    // grand total's own 100%.
    expect(pcts).toContain("25.0%");
    expect(pcts).toContain("75.0%");
    expect(pcts.filter((p) => p === "100.0%").length).toBe(2);
  });

  it("offers a single expand/collapse control for every category", () => {
    const { getByText } = renderGrid([
      row(1, "Sauces", { openingStock: 1, remainingStock: 1 }),
      row(2, "Vinegars", { openingStock: 1, remainingStock: 1 }),
    ]);
    // Categories default to collapsed, so the control offers to expand.
    const toggle = getByText("Expand all");
    fireEvent.click(toggle);
    expect(getByText("Collapse all")).toBeTruthy();
  });

  it("keeps subtotal rows out of the collapsed-row class, so totals survive collapsing", () => {
    const { container } = renderGrid([
      row(1, "Sauces", { openingStock: 5, remainingStock: 5 }),
    ]);
    const subtotal = container.querySelector("tr.ae-row-subtotal");
    expect(subtotal).toBeTruthy();
    expect(subtotal?.classList.contains("ae-row-collapsed")).toBe(false);
  });
});
