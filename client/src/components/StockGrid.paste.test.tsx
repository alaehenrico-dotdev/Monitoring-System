import { describe, expect, it, vi } from "vitest";
import { fireEvent, render } from "@testing-library/react";
import type { Product } from "../types";
import { StockGrid, type GridColumn, type GridRow } from "./StockGrid";
import { extraColumnKey } from "../hooks/useExtraColumns";
import { MAX_PASTE_CELLS } from "../utils/gridPaste";

// ToastHost lives in Layout, not in a bare grid render, so the toast has
// nowhere to paint here - assert on what the grid published instead.
const showToast = vi.hoisted(() => vi.fn());
vi.mock("./Toast", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./Toast")>()),
  showToast,
}));

const columns: GridColumn[] = [
  { key: "openingStock", label: "Opening", editable: false },
  { key: "stockIn", label: "Stocks In", editable: true, tone: "in" },
  { key: "stockOut", label: "Stocks Out", editable: true, tone: "out" },
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
    entry: { openingStock: 10, stockIn: 0, stockOut: 0, remainingStock: 10 },
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
      {...extra}
    />,
  );
  return { ...result, onCommitMany };
}

function cell(container: HTMLElement, key: string): HTMLInputElement {
  const el = container.querySelector<HTMLInputElement>(`[data-cell="${key}"]`);
  if (!el) throw new Error(`no cell ${key}`);
  return el;
}

/// Fires a paste at the table with `text` on the clipboard, with `cellKey`
/// focused - the grid reads document.activeElement, the way a real paste
/// arrives from whichever input has focus.
function paste(container: HTMLElement, cellKey: string, text: string) {
  const input = cell(container, cellKey);
  input.focus();
  const table = container.querySelector("table")!;
  const event = new Event("paste", { bubbles: true, cancelable: true });
  Object.defineProperty(event, "clipboardData", {
    value: { getData: () => text },
  });
  fireEvent(table, event);
  return event;
}

describe("StockGrid - paste from a spreadsheet", () => {
  it("stages a whole pasted block as ONE call, so one Ctrl+Z reverts it all", () => {
    const { container, onCommitMany } = renderGrid();
    paste(container, "1:stockIn", "1\t2\n3\t4");

    expect(onCommitMany).toHaveBeenCalledTimes(1);
    expect(onCommitMany).toHaveBeenCalledWith([
      { productId: 1, key: "stockIn", value: 1 },
      { productId: 1, key: "stockOut", value: 2 },
      { productId: 2, key: "stockIn", value: 3 },
      { productId: 2, key: "stockOut", value: 4 },
    ]);
  });

  it("leaves a single value in a single cell to the browser, as before", () => {
    const { container, onCommitMany } = renderGrid();
    const event = paste(container, "1:stockIn", "42");

    expect(onCommitMany).not.toHaveBeenCalled();
    expect(event.defaultPrevented).toBe(false);
  });

  it("takes over the paste only for a real block", () => {
    const { container } = renderGrid();
    expect(paste(container, "1:stockIn", "1\t2").defaultPrevented).toBe(true);
  });

  it("skips calculated columns but keeps filling the editable ones", () => {
    const { container, onCommitMany } = renderGrid();
    // Anchored on Stocks Out: the block covers Stocks Out and Remaining.
    paste(container, "1:stockOut", "5\t6");

    expect(onCommitMany).toHaveBeenCalledWith([
      { productId: 1, key: "stockOut", value: 5 },
    ]);
  });

  it("drops only the invalid cells, not the whole paste", () => {
    const { container, onCommitMany } = renderGrid();
    paste(container, "1:stockIn", "1\t-2\nabc\t4");

    expect(onCommitMany).toHaveBeenCalledWith([
      { productId: 1, key: "stockIn", value: 1 },
      { productId: 2, key: "stockOut", value: 4 },
    ]);
  });

  it("leaves blanks in the block unchanged", () => {
    const { container, onCommitMany } = renderGrid();
    paste(container, "1:stockIn", "7\t\n\t8");

    expect(onCommitMany).toHaveBeenCalledWith([
      { productId: 1, key: "stockIn", value: 7 },
      { productId: 2, key: "stockOut", value: 8 },
    ]);
  });

  it("flows across an extra column, and refuses the main column it totals", () => {
    const { container, onCommitMany } = renderGrid({
      extraColumns: { stockIn: [1] },
      onAddExtraColumns: vi.fn(),
      onRemoveExtraColumns: vi.fn(),
    });
    // Stocks In is now the read-only sum of its added column, so the block
    // must skip it and land on the added column and Stocks Out.
    paste(container, `1:${extraColumnKey("stockIn", 1)}`, "4\t5");

    expect(onCommitMany).toHaveBeenCalledWith([
      { productId: 1, key: extraColumnKey("stockIn", 1), value: 4 },
      { productId: 1, key: "stockOut", value: 5 },
    ]);
  });

  it("applies nothing at all when the block is over the cell cap", () => {
    const { container, onCommitMany } = renderGrid();
    const line = "1\t1\t1\t1\t1\t1\t1\t1\t1\t1";
    const text = Array.from({ length: 51 }, () => line).join("\n"); // 510
    paste(container, "1:stockIn", text);

    expect(onCommitMany).not.toHaveBeenCalled();
    expect(showToast).toHaveBeenCalledWith(
      expect.stringContaining(`the limit is ${MAX_PASTE_CELLS}`),
      "error",
    );
    expect(onCommitMany).not.toHaveBeenCalled();
  });

  it("reports what it pasted and what it skipped", () => {
    const { container } = renderGrid();
    paste(container, "1:stockIn", "1\t-2\nabc\t4");

    // Detail rides on the toast's own tooltip (4th arg), not on the shared
    // toast stack - so it can't outlive the message it explains.
    expect(showToast).toHaveBeenCalledWith(
      "Pasted 2 cells, skipped 2",
      "success",
      undefined,
      "negative value: Product 1 / Stocks Out\nnot a number: Product 2 / Stocks In",
    );
  });

  it("ignores a paste on a read-only grid", () => {
    const onCommitMany = vi.fn();
    const { container } = render(
      <StockGrid rows={rows()} columns={columns} onCommit={vi.fn()} readOnly />,
    );
    const table = container.querySelector("table")!;
    const event = new Event("paste", { bubbles: true, cancelable: true });
    Object.defineProperty(event, "clipboardData", { value: { getData: () => "1\t2" } });
    fireEvent(table, event);

    expect(onCommitMany).not.toHaveBeenCalled();
    expect(event.defaultPrevented).toBe(false);
  });

  it("does nothing when no cell has focus", () => {
    const { container, onCommitMany } = renderGrid();
    const table = container.querySelector("table")!;
    (document.activeElement as HTMLElement | null)?.blur();
    const event = new Event("paste", { bubbles: true, cancelable: true });
    Object.defineProperty(event, "clipboardData", { value: { getData: () => "1\t2" } });
    fireEvent(table, event);

    expect(onCommitMany).not.toHaveBeenCalled();
  });
});
