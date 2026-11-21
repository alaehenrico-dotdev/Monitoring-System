import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import type { Product } from "../types";
import { StockGrid, type GridColumn, type GridRow } from "./StockGrid";

const columns: GridColumn[] = [
  { key: "openingStock", label: "Opening", editable: false },
  { key: "stockIn", label: "Stocks In", editable: true, tone: "in" },
];

const rows: GridRow[] = [
  { product: { id: 1, sku: "AFP001", name: "Soy", category: "Sauces" } as Product, entry: { id: 1, openingStock: 10, stockIn: 1 } },
  { product: { id: 2, sku: "AFP002", name: "Vinegar", category: "Sauces" } as Product, entry: { id: 2, openingStock: 10, stockIn: 2 } },
  { product: { id: 3, sku: "AFP003", name: "Oil", category: "Oils" } as Product, entry: { id: 3, openingStock: 10, stockIn: 3 } },
];

afterEach(cleanup);

const bar = (category: string) => screen.getByRole("button", { name: new RegExp(`^${category}`) });
const hidden = (name: string) => screen.getByText(name).closest("tr")!.classList.contains("ae-row-collapsed");

describe("StockGrid - a category with unsaved edits", () => {
  it("opens by itself (so the edit is seen), turns its bar blue, and says so", () => {
    render(<StockGrid rows={rows} columns={columns} onCommit={vi.fn()} pending={{ 1: { stockIn: 9 } }} />);
    expect(hidden("Soy")).toBe(false);
    expect(bar("Sauces").classList.contains("ae-cat-toggle--edited")).toBe(true);
    expect(bar("Sauces").getAttribute("title")).toBe("Collapse Sauces (has unsaved edits)");
    expect(bar("Sauces").textContent).toContain("unsaved edits");
    // A category with nothing staged stays collapsed and keeps the normal bar.
    expect(hidden("Oil")).toBe(true);
    expect(bar("Oils").classList.contains("ae-cat-toggle--edited")).toBe(false);
  });

  it("can be collapsed, stays blue while collapsed, and can be opened again", () => {
    render(<StockGrid rows={rows} columns={columns} onCommit={vi.fn()} pending={{ 1: { stockIn: 9 } }} />);
    const sauces = bar("Sauces");
    expect(sauces.getAttribute("aria-disabled")).toBeNull();

    fireEvent.click(sauces);
    // The rows fade out first (a short timer), then are hidden.
    return vi.waitFor(() => expect(hidden("Soy")).toBe(true)).then(() => {
      expect(bar("Sauces").getAttribute("aria-expanded")).toBe("false");
      expect(bar("Sauces").classList.contains("ae-cat-toggle--edited")).toBe(true);
      expect(bar("Sauces").getAttribute("title")).toBe("Expand Sauces (has unsaved edits)");

      fireEvent.click(bar("Sauces"));
      return vi.waitFor(() => expect(hidden("Soy")).toBe(false));
    });
  });

  it("turns blue the moment a cell is edited, and back once the edit is saved or discarded", () => {
    function Harness() {
      const [pending, setPending] = useState<Record<number, Record<string, number>>>({});
      return (
        <>
          <button onClick={() => setPending({ 3: { stockIn: 7 } })}>stage</button>
          <button onClick={() => setPending({})}>discard</button>
          <StockGrid rows={rows} columns={columns} onCommit={vi.fn()} pending={pending} />
        </>
      );
    }
    render(<Harness />);
    expect(bar("Oils").classList.contains("ae-cat-toggle--edited")).toBe(false);
    fireEvent.click(screen.getByText("stage"));
    expect(bar("Oils").classList.contains("ae-cat-toggle--edited")).toBe(true);
    fireEvent.click(screen.getByText("discard"));
    expect(bar("Oils").classList.contains("ae-cat-toggle--edited")).toBe(false);
  });

  it("is not part of the row selection while it is collapsed", () => {
    render(<StockGrid rows={rows} columns={columns} onCommit={vi.fn()} pending={{ 1: { stockIn: 9 } }} />);
    fireEvent.click(bar("Sauces"));
    return vi.waitFor(() => expect(hidden("Soy")).toBe(true)).then(() => {
      fireEvent.mouseDown(screen.getByText("Soy"), { button: 0 });
      expect(document.querySelectorAll("tr.ae-row-selected").length).toBe(0);
    });
  });
});
