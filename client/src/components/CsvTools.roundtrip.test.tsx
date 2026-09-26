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

// Opening Stock is the ONLY column Import ever writes (see handleImportFile's
// own doc comment) - the other columns here (editable and importable-only
// alike) exist purely so these tests can prove a file that also changes them
// is still ignored for anything but Opening Stock.
const columns: CsvColumn[] = [
  { key: "openingStock", label: "Stocks (Opening)", editable: false, importable: true, aliases: ["Remaining Stocks"] },
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

const rows = [{ product, entry: { openingStock: 20, stockInOlToOff: 5, productionIn: 10, deliveryOut: 3 } }];

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
 * Import's sole job is carrying Opening Stock forward from a file's
 * Remaining Stock (see handleImportFile's own doc comment) - every other
 * cell starts at 0 each day and is entered fresh, so a file that also
 * carries old figures for those must never apply them, even when they
 * genuinely differ from what's on the grid.
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

  it("imports a changed Opening Stock but ignores every other column even when they also changed", async () => {
    const { onImportRow } = renderCsvTools();

    const csv = [
      "CATEGORY,SKU,STOCKS (OPENING),STOCKS IN (OL→OFF),PRODUCTION (IN),DELIVERY (OUT)",
      "Class A (Liter),Sweet A,50,999,999,999",
    ].join("\r\n");
    const file = new File([csv], "edit.csv", { type: "text/csv" });
    const input = document.querySelector('input[type="file"]') as HTMLInputElement;
    fireEvent.change(input, { target: { files: [file] } });

    await waitFor(() => expect(screen.getByText("Review Import")).toBeInTheDocument());

    expect(screen.getByRole("button", { name: "Save (1)" })).toBeEnabled();
    expect(screen.getByText("Stocks (Opening)")).toBeInTheDocument();
    expect(screen.queryByText("Stocks In (Ol→Off)")).not.toBeInTheDocument();
    expect(screen.queryByText("Production (In)")).not.toBeInTheDocument();
    expect(screen.queryByText("Delivery (Out)")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Save (1)" }));
    await waitFor(() => expect(onImportRow).toHaveBeenCalledTimes(1));
    // Only openingStock is ever passed through, never the other columns that
    // also differed in the file.
    expect(onImportRow).toHaveBeenCalledWith(product.id, { openingStock: 50 });
  });

  it("a blank Opening Stock cell is left untouched, not silently staged as 0", async () => {
    const { onImportRow } = renderCsvTools();

    const csv = [
      "CATEGORY,SKU,STOCKS (OPENING),STOCKS IN (OL→OFF),PRODUCTION (IN),DELIVERY (OUT)",
      "Class A (Liter),Sweet A,,999,999,999",
    ].join("\r\n");
    const file = new File([csv], "edit.csv", { type: "text/csv" });
    const input = document.querySelector('input[type="file"]') as HTMLInputElement;
    fireEvent.change(input, { target: { files: [file] } });

    await waitFor(() => expect(screen.getByText("Review Import")).toBeInTheDocument());

    const saveButton = screen.getByRole("button", { name: "Save (0)" });
    expect(saveButton).toBeDisabled();
    expect(onImportRow).not.toHaveBeenCalled();
  });

  it("reads Opening Stock from a Remaining Stock column when the file has no Opening Stock column of its own", async () => {
    const { onImportRow } = renderCsvTools();

    // Mirrors the real monthly report (Section 8.1): its own "Stocks"
    // column is that day's already-stale opening balance, but this fixture
    // only has the ending balance - exactly the switchover/backfill case
    // Opening Stock import exists for.
    const csv = ["CATEGORY,SKU,REMAINING STOCKS", "Class A (Liter),Sweet A,50"].join("\r\n");
    const file = new File([csv], "monthly-report.csv", { type: "text/csv" });
    const input = document.querySelector('input[type="file"]') as HTMLInputElement;
    fireEvent.change(input, { target: { files: [file] } });

    await waitFor(() => expect(screen.getByText("Review Import")).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: "Save (1)" }));
    await waitFor(() => expect(onImportRow).toHaveBeenCalledTimes(1));
    expect(onImportRow).toHaveBeenCalledWith(product.id, { openingStock: 50 });
  });
});

describe("CsvTools - saving state", () => {
  it("disables Save and shows a loading label while the save is in flight", async () => {
    let resolveImport!: () => void;
    const onImportRow = vi.fn(() => new Promise<void>((resolve) => (resolveImport = resolve)));
    render(
      <TopProgressProvider>
        <CsvTools
          filenamePrefix="offline-entry"
          date="2026-06-01"
          rows={rows}
          columns={columns}
          onImportRow={onImportRow}
          getPendingValue={() => undefined}
          canImport
        />
      </TopProgressProvider>,
    );

    const csv = ["CATEGORY,SKU,STOCKS (OPENING)", "Class A (Liter),Sweet A,50"].join("\r\n");
    const file = new File([csv], "edit.csv", { type: "text/csv" });
    const input = document.querySelector('input[type="file"]') as HTMLInputElement;
    fireEvent.change(input, { target: { files: [file] } });
    await waitFor(() => expect(screen.getByText("Review Import")).toBeInTheDocument());

    fireEvent.click(screen.getByRole("button", { name: "Save (1)" }));

    await waitFor(() => expect(screen.getByRole("button", { name: "Saving…" })).toBeDisabled());
    expect(onImportRow).toHaveBeenCalledTimes(1);

    resolveImport();
    await waitFor(() => expect(screen.queryByText("Review Import")).not.toBeInTheDocument());
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
      (productId, changes) =>
        productId === product.id && changes.openingStock === 50
          ? "This would take Sweet A's Offline stock below zero (would end at -3)."
          : undefined,
    );

    const csv = ["CATEGORY,SKU,STOCKS (OPENING)", "Class A (Liter),Sweet A,50"].join("\r\n");
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

    const csv = ["CATEGORY,SKU,STOCKS (OPENING)", "Class A (Liter),Sweet A,50"].join("\r\n");
    const file = new File([csv], "edit.csv", { type: "text/csv" });
    const input = document.querySelector('input[type="file"]') as HTMLInputElement;
    fireEvent.change(input, { target: { files: [file] } });

    await waitFor(() => expect(screen.getByText("Review Import")).toBeInTheDocument());
    expect(screen.queryByText("⚠ May fail to save")).not.toBeInTheDocument();
  });
});
