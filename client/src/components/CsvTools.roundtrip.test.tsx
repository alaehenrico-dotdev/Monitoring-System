import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { TopProgressProvider } from "../hooks/useTopProgress";
import type { Product } from "../types";
import { CsvTools, type CsvColumn } from "./CsvTools";

// Only downloadCsv is replaced (it triggers a real browser download, which
// jsdom has no destination for) - toCsv/parseCsv stay real, so this exercises
// the actual export/import code paths, not a re-implementation of them.
vi.mock("../utils/csv", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../utils/csv")>();
  return { ...actual, downloadCsv: vi.fn() };
});
import { downloadCsv } from "../utils/csv";

const columns: CsvColumn[] = [
  { key: "stockInOlToOff", label: "Stocks In (Ol→Off)", editable: true, aliases: ["Stocks In"] },
  { key: "productionIn", label: "Production (In)", editable: true },
  { key: "deliveryOut", label: "Delivery (Out)", editable: false, importable: true, aliases: ["Delivery(Out)"] },
];

const product: Product = {
  id: 1,
  sku: "AFP001",
  name: "Sweet A",
  category: "Class A (Liter)",
  unit: "Liter",
  isActive: true,
  sortOrder: 0,
};

const rows = [{ product, entry: { stockInOlToOff: 5, productionIn: 10, deliveryOut: 3 } }];

function renderCsvTools(validateImport?: (productId: number, changes: Record<string, number>) => string | undefined) {
  const onImportRow = vi.fn().mockResolvedValue(undefined);
  render(
    <TopProgressProvider>
      <CsvTools
        filenamePrefix="offline-entry"
        date="2026-06-01"
        rows={rows}
        columns={columns}
        onImportRow={onImportRow}
        getPendingValue={() => undefined}
        validateImport={validateImport}
        canImport
      />
    </TopProgressProvider>,
  );
  return { onImportRow };
}

/**
 * Section 3.1's own round-trip guarantee: exporting a grid and re-importing
 * it completely unmodified must stage zero changes - a round-tripped file
 * (open in Excel, don't touch anything, save) is common enough that this
 * silently resubmitting every cell as a "real" edit would be its own bug
 * (spurious change-log entries, "changed" cells that never actually changed).
 */
describe("CsvTools - export/import round trip", () => {
  it("stages zero changes when the exported CSV is re-imported unmodified", async () => {
    const { onImportRow } = renderCsvTools();

    fireEvent.click(screen.getByRole("button", { name: "Export" }));
    expect(downloadCsv).toHaveBeenCalledTimes(1);
    const [, content] = vi.mocked(downloadCsv).mock.calls[0];

    const file = new File([content], "offline-entry-2026-06-01.csv", { type: "text/csv" });
    const input = document.querySelector('input[type="file"]') as HTMLInputElement;
    fireEvent.change(input, { target: { files: [file] } });

    await waitFor(() => expect(screen.getByText("Review Import")).toBeInTheDocument());

    const saveButton = screen.getByRole("button", { name: "Save (0)" });
    expect(saveButton).toBeDisabled();
    expect(onImportRow).not.toHaveBeenCalled();
  });

  it("a blank cell is left untouched, not silently staged as 0", async () => {
    const { onImportRow } = renderCsvTools();

    // Production (In) is blank - only Stocks In (Ol→Off) actually changed.
    const csv = [
      "CATEGORY,SKU,STOCKS IN (OL→OFF),PRODUCTION (IN),DELIVERY (OUT)",
      "Class A (Liter),Sweet A,7,,3",
    ].join("\r\n");
    const file = new File([csv], "edit.csv", { type: "text/csv" });
    const input = document.querySelector('input[type="file"]') as HTMLInputElement;
    fireEvent.change(input, { target: { files: [file] } });

    await waitFor(() => expect(screen.getByText("Review Import")).toBeInTheDocument());

    expect(screen.getByRole("button", { name: "Save (1)" })).toBeEnabled();
    expect(screen.getByText("Stocks In (Ol→Off)")).toBeInTheDocument();
    expect(screen.queryByText("Production (In)")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Save (1)" }));
    await waitFor(() => expect(onImportRow).toHaveBeenCalledTimes(1));
    // The blank Production (In) cell must not have been folded in as 0.
    expect(onImportRow).toHaveBeenCalledWith(product.id, { stockInOlToOff: 7 });
  });
});

/**
 * Option 1 from the "flagged import" discussion: an advisory pre-check that
 * surfaces a likely save failure (e.g. the negative-stock guard) IN the
 * Review modal, before Save is ever clicked - without blocking staging or
 * Save itself, since the server remains the only real enforcement point.
 */
describe("CsvTools - validateImport advisory warning", () => {
  it("shows the warning in the Review modal but still stages and counts the row toward Save", async () => {
    const { onImportRow } = renderCsvTools(
      (productId, changes) => (productId === product.id && changes.stockInOlToOff === 7 ? "This would take Sweet A's Offline stock below zero (would end at -3)." : undefined),
    );

    const csv = ["CATEGORY,SKU,STOCKS IN (OL→OFF),PRODUCTION (IN),DELIVERY (OUT)", "Class A (Liter),Sweet A,7,10,3"].join("\r\n");
    const file = new File([csv], "edit.csv", { type: "text/csv" });
    const input = document.querySelector('input[type="file"]') as HTMLInputElement;
    fireEvent.change(input, { target: { files: [file] } });

    await waitFor(() => expect(screen.getByText("Review Import")).toBeInTheDocument());

    expect(screen.getByText("⚠ May fail to save")).toBeInTheDocument();
    expect(screen.getByText(/This would take Sweet A's Offline stock below zero/)).toBeInTheDocument();
    // Still fully stageable/saveable - this is advisory, not a second gate.
    const saveButton = screen.getByRole("button", { name: "Save (1)" });
    expect(saveButton).toBeEnabled();

    fireEvent.click(saveButton);
    await waitFor(() => expect(onImportRow).toHaveBeenCalledTimes(1));
  });

  it("shows no warning section when validateImport finds nothing wrong", async () => {
    renderCsvTools(() => undefined);

    const csv = ["CATEGORY,SKU,STOCKS IN (OL→OFF),PRODUCTION (IN),DELIVERY (OUT)", "Class A (Liter),Sweet A,7,10,3"].join("\r\n");
    const file = new File([csv], "edit.csv", { type: "text/csv" });
    const input = document.querySelector('input[type="file"]') as HTMLInputElement;
    fireEvent.change(input, { target: { files: [file] } });

    await waitFor(() => expect(screen.getByText("Review Import")).toBeInTheDocument());
    expect(screen.queryByText("⚠ May fail to save")).not.toBeInTheDocument();
  });
});
