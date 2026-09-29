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
