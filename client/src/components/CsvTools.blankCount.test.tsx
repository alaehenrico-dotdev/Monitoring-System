import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { TopProgressProvider } from "../hooks/useTopProgress";
import type { Product } from "../types";
import { CsvTools, type CsvColumn } from "./CsvTools";

const columns: CsvColumn[] = [{ key: "manualCount", label: "Manual Count", editable: true, aliases: ["Manual Counting"] }];

const product = (id: number, name: string): Product => ({
  id,
  sku: null,
  name,
  category: "Class A (Liter)",
  unit: "Liter",
  isActive: true,
  sortOrder: id,
  lowStockThreshold: null,
});

const rows = [
  { product: product(1, "Sweet A"), entry: { manualCount: null } },
  { product: product(2, "Special A"), entry: { manualCount: null } },
];

function importFile(csv: string) {
  render(
    <TopProgressProvider>
      <CsvTools
        filenamePrefix="manual-count"
        date="2026-10-14"
        rows={rows}
        columns={columns}
        onImportRow={vi.fn().mockResolvedValue(undefined)}
        getPendingValue={() => undefined}
        canImport
        importKeys={["manualCount"]}
        blankAsZero
        showExport={false}
        showPdf={false}
      />
    </TopProgressProvider>,
  );
  const input = document.querySelector('input[type="file"]') as HTMLInputElement;
  fireEvent.change(input, { target: { files: [new File([csv], "counts.csv", { type: "text/csv" })] } });
}

describe("CsvTools - counts the file leaves blank", () => {
  it("warns that a blank count would be saved as 0 and names the product", async () => {
    importFile("PRODUCTS,Manual Count\nSweet A,5\nSpecial A,\n");
    await waitFor(() => expect(screen.getByText("Review Import")).toBeInTheDocument());
    const alert = screen.getByRole("alert");
    expect(alert.textContent).toMatch(/1\s*row\(s\) have no count in this file and will be saved as 0/);
    expect(alert.textContent).toContain("Special A");
    expect(alert.textContent).not.toContain("Sweet A");
  });

  it("shows no warning when every count is filled in", async () => {
    importFile("PRODUCTS,Manual Count\nSweet A,5\nSpecial A,7\n");
    await waitFor(() => expect(screen.getByText("Review Import")).toBeInTheDocument());
    expect(screen.queryByRole("alert")).toBeNull();
  });
});
