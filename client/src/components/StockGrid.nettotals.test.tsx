import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import type { Product } from "../types";
import { StockGrid, type GridColumn, type GridRow } from "./StockGrid";

// Offline's Delivery (Out) TOTALS are net of Backloads: the subtotal and grand total show delivery
// less backloads and move as backloads change. The cells, and Remaining Stocks, are not touched.
const columns: GridColumn[] = [
  { key: "deliveryOut", label: "Delivery (Out)", editable: true },
  { key: "backloads", label: "Backloads", editable: true },
  { key: "remainingStock", label: "Remaining", editable: false },
];

const rows = (backloads: number[]): GridRow[] =>
  backloads.map((b, i) => ({
    product: { id: i + 1, sku: `S${i + 1}`, name: `Product ${i + 1}`, category: "Sauces" } as Product,
    entry: { id: 100 + i, deliveryOut: 100, backloads: b, remainingStock: 500 + b - 100 },
  }));

const totalsRow = (cls: string) => [...document.querySelector(`tr.${cls}`)!.querySelectorAll("td")].map((td) => td.textContent);

afterEach(cleanup);

describe("StockGrid netTotals", () => {
  it("totals Delivery (Out) less Backloads in the subtotal and grand total, leaving the other columns alone", () => {
    render(<StockGrid rows={rows([30, 20])} columns={columns} onCommit={vi.fn()} netTotals={{ deliveryOut: "backloads" }} />);
    // 2 x 100 delivered, 50 back: 150. Backloads and Remaining are plain sums (50 and 2 x 400 + 50).
    expect(totalsRow("ae-row-grand").slice(1)).toEqual(["150", "50", "850"]);
    expect(totalsRow("ae-row-subtotal").slice(1)).toEqual(["150", "50", "850"]);
  });

  it("moves the total as backloads change, and explains the figure on hover", () => {
    const { rerender } = render(<StockGrid rows={rows([0, 0])} columns={columns} onCommit={vi.fn()} netTotals={{ deliveryOut: "backloads" }} />);
    expect(totalsRow("ae-row-grand")[1]).toBe("200");
    rerender(<StockGrid rows={rows([40, 0])} columns={columns} onCommit={vi.fn()} netTotals={{ deliveryOut: "backloads" }} />);
    expect(totalsRow("ae-row-grand")[1]).toBe("160");
    expect(document.querySelector("tr.ae-row-grand td[title]")!.getAttribute("title")).toBe("Delivery (Out) total, less Backloads");
  });

  it("shows a negative total when more came back than went out", () => {
    render(<StockGrid rows={rows([150])} columns={columns} onCommit={vi.fn()} netTotals={{ deliveryOut: "backloads" }} />);
    expect(totalsRow("ae-row-grand")[1]).toBe("-50");
  });

  it("leaves every total as a plain sum when no netTotals are given", () => {
    render(<StockGrid rows={rows([30, 20])} columns={columns} onCommit={vi.fn()} />);
    expect(totalsRow("ae-row-grand").slice(1)).toEqual(["200", "50", "850"]);
    expect(screen.queryByTitle(/less/)).toBeNull();
  });
});
