import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";

const api = vi.hoisted(() => ({ listProducts: vi.fn(), reorderProducts: vi.fn(), syncProducts: vi.fn() }));
vi.mock("../api/products", () => api);
const templates = vi.hoisted(() => ({ listOrderTemplates: vi.fn(), saveOrderTemplate: vi.fn(), deleteOrderTemplate: vi.fn() }));
vi.mock("../api/orderTemplates", () => templates);
const xlsx = vi.hoisted(() => ({ readXlsxColumnA: vi.fn() }));
vi.mock("../utils/xlsx", () => xlsx);

import { ReorderProductsButton } from "./ReorderProductsButton";

const product = (id: number, name: string, category: string, sku: string | null = null) => ({
  id, sku, name, category, unit: "pc", isActive: true, sortOrder: id, lowStockThreshold: null,
});
const cell = (row: number, text: string, size: number) => ({ row, text, bold: true, size });

// Each row has a "Move <name> up" button, which gives the names in list order.
const names = () => screen.getAllByRole("button", { name: /^Move .* up$/ }).map((b) => b.getAttribute("aria-label")!.replace(/^Move | up$/g, ""));

async function open() {
  render(<ReorderProductsButton isAdmin />);
  fireEvent.click(screen.getByRole("button", { name: "Arrange product order" }));
  await screen.findByText("Sweet A");
}

// jsdom's File has no arrayBuffer() in every version; the reader is mocked, so any buffer will do.
const file = () => Object.assign(new File(["x"], "encoder order.xlsx"), { arrayBuffer: () => Promise.resolve(new ArrayBuffer(1)) });
const pick = (f: File) => fireEvent.change(document.querySelector('input[type="file"]') as HTMLInputElement, { target: { files: [f] } });

beforeEach(() => {
  vi.clearAllMocks();
  api.listProducts.mockResolvedValue([
    product(1, "Special", "Premium (Liter)"),
    product(2, "Sweet A", "Class A (Liter)"),
    product(3, "Mystery", "Class A (Liter)"),
  ]);
  api.reorderProducts.mockResolvedValue({ moved: 3, total: 3 });
  templates.listOrderTemplates.mockResolvedValue([]);
  api.syncProducts.mockResolvedValue({ created: 1, moved: 0, renamed: 0, reactivated: 0, reordered: 2, total: 3 });
});

describe("Arrange product order - Excel template", () => {
  it("reviews exactly the template's products, then applies them through the product sync", async () => {
    xlsx.readXlsxColumnA.mockResolvedValue([
      { name: "OCT 8", cells: [cell(2, "SKU'S", 20), cell(5, "CLASS A (LITER)", 16), cell(6, "SWEET A", 11), cell(7, "PREMIUM (LITER)", 16), cell(8, "SPECIAL", 11), cell(9, "GONE", 11)] },
    ]);
    await open();

    pick(file());

    // Only the template's 3 products - "Mystery" is not in it - and the missing one is flagged as new.
    expect(await screen.findByText(/3 products in 2 categories/)).toBeTruthy();
    expect(screen.getByText(/1 will be added\./)).toBeTruthy();
    expect(screen.getByText(/1 other product not in the template stay in the system, after these/)).toBeTruthy();
    expect(screen.getByText("NEW")).toBeTruthy();
    expect(screen.queryByText("Mystery")).toBeNull();
    expect(api.syncProducts).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "Apply template" }));

    await waitFor(() =>
      expect(api.syncProducts).toHaveBeenCalledWith([
        { category: "Class A (Liter)", name: "SWEET A", productId: 2 },
        { category: "Premium (Liter)", name: "SPECIAL", productId: 1 },
        { category: "Premium (Liter)", name: "GONE" },
      ]),
    );
    expect(api.reorderProducts).not.toHaveBeenCalled();
  });

  it("can link a new template row to a similar existing product, which keeps its own name rather than being renamed or duplicated", async () => {
    api.listProducts.mockResolvedValue([product(1, "Sweet A", "Class A (Liter)"), product(2, "Palm Oil Liter", "New Products")]);
    xlsx.readXlsxColumnA.mockResolvedValue([
      { name: "OCT 8", cells: [cell(5, "CLASS A -(LITER)", 16), cell(6, "SWEET A", 11), cell(7, "PALM OIL", 11)] },
    ]);
    await open();
    pick(file());
    await screen.findByText(/2 products in 1 category/);

    fireEvent.change(screen.getByLabelText("Is PALM OIL an existing product?"), { target: { value: "2" } });
    expect(screen.getByText(/same as Palm Oil Liter/)).toBeTruthy();
    expect(screen.getByText(/moves from New Products/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Apply template" }));

    await waitFor(() =>
      expect(api.syncProducts).toHaveBeenCalledWith([
        { category: "Class A (Liter)", name: "SWEET A", productId: 1 },
        { category: "Class A (Liter)", name: "PALM OIL", productId: 2 },
      ]),
    );
  });

  it("can merge a product added earlier from a template (no SKU) into the real product, after a confirm", async () => {
    api.listProducts.mockResolvedValue([
      product(1, "Sweet A", "Class A (Liter)", "AFP001"),
      product(2, "Palm Oil Liter", "New Products", "AFP069"),
      product(3, "PALM OIL", "Class A (Liter)"), // added by an earlier template, since used
    ]);
    xlsx.readXlsxColumnA.mockResolvedValue([
      { name: "OCT 8", cells: [cell(5, "CLASS A -(LITER)", 16), cell(6, "SWEET A", 11), cell(7, "PALM OIL", 11)] },
    ]);
    await open();
    pick(file());
    await screen.findByText(/2 products in 1 category/);
    expect(screen.getByText("NEW · no SKU")).toBeTruthy();
    // Only the product with no SKU can be merged away.
    expect(screen.queryByLabelText("Is SWEET A an existing product?")).toBeNull();

    fireEvent.change(screen.getByLabelText("Is PALM OIL an existing product?"), { target: { value: "2" } });

    expect(screen.getByText(/merges "PALM OIL" into it/)).toBeTruthy();
    expect(screen.getByText(/cannot be undone - take a backup first/)).toBeTruthy();
    // The product list's own name is shown, not the template's spelling.
    expect(screen.getByText("Palm Oil Liter")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Apply template & merge 1" }));
    expect(api.syncProducts).not.toHaveBeenCalled();
    fireEvent.click(await screen.findByRole("button", { name: "Merge and apply" }));

    await waitFor(() =>
      expect(api.syncProducts).toHaveBeenCalledWith([
        { category: "Class A (Liter)", name: "SWEET A", productId: 1 },
        { category: "Class A (Liter)", name: "PALM OIL", productId: 2, mergeFromId: 3 },
      ]),
    );
  });

  it("shows the server's message when a merge is refused (both have entries for a date)", async () => {
    api.listProducts.mockResolvedValue([product(1, "Sweet A", "Class A (Liter)", "AFP001"), product(2, "Palm Oil Liter", "New Products", "AFP069"), product(3, "PALM OIL", "Class A (Liter)")]);
    xlsx.readXlsxColumnA.mockResolvedValue([{ name: "OCT 8", cells: [cell(5, "CLASS A -(LITER)", 16), cell(7, "PALM OIL", 11)] }]);
    api.syncProducts.mockRejectedValue(new Error("PALM OIL and Palm Oil Liter both have entries for the same period: Online 2026-10-12 Morning"));
    await open();
    pick(file());
    await screen.findByText(/1 product in 1 category/);
    fireEvent.change(screen.getByLabelText("Is PALM OIL an existing product?"), { target: { value: "2" } });
    fireEvent.click(screen.getByRole("button", { name: "Apply template & merge 1" }));
    fireEvent.click(await screen.findByRole("button", { name: "Merge and apply" }));

    expect((await screen.findByRole("alert")).textContent).toContain("Online 2026-10-12 Morning");
  });

  it("goes back to the drag list without saving anything", async () => {
    xlsx.readXlsxColumnA.mockResolvedValue([{ name: "OCT 8", cells: [cell(1, "CLASS A (LITER)", 16), cell(2, "SWEET A", 11)] }]);
    await open();
    pick(file());
    await screen.findByText(/1 product in 1 category/);

    fireEvent.click(screen.getByRole("button", { name: "Back to list" }));

    expect(names()).toEqual(["Special", "Sweet A", "Mystery"]);
    expect(api.syncProducts).not.toHaveBeenCalled();
  });

  it("offers a sheet choice when the workbook has several", async () => {
    xlsx.readXlsxColumnA.mockResolvedValue([
      { name: "OCT 8", cells: [cell(1, "PREMIUM (LITER)", 16), cell(2, "SPECIAL", 11)] },
      { name: "OCT 9", cells: [cell(1, "CLASS A (LITER)", 16), cell(2, "SWEET A", 11), cell(3, "MORE", 11)] },
    ]);
    await open();
    pick(file());
    await screen.findByText(/1 product in 1 category/);

    fireEvent.change(screen.getByLabelText("Template sheet"), { target: { value: "1" } });

    expect(await screen.findByText(/2 products in 1 category/)).toBeTruthy();
  });

  it("says so when the file has nothing to read, and leaves the list alone", async () => {
    xlsx.readXlsxColumnA.mockResolvedValue([{ name: "Cover", cells: [{ row: 1, text: "hello", bold: false, size: 11 }] }]);
    await open();
    pick(file());
    expect((await screen.findByRole("alert")).textContent).toMatch(/No bold category and product names/);
    expect(names()).toEqual(["Special", "Sweet A", "Mystery"]);
  });

  it("shows the reader's message when the file is not a workbook", async () => {
    xlsx.readXlsxColumnA.mockRejectedValue(new Error("This is not a valid .xlsx file"));
    await open();
    pick(file());
    expect((await screen.findByRole("alert")).textContent).toBe("This is not a valid .xlsx file");
  });

  describe("saved templates", () => {
    const rows = [{ category: "CLASS A (LITER)", name: "SWEET A" }, { category: "PREMIUM (LITER)", name: "SPECIAL" }];
    const savedTemplate = { id: 5, name: "Encoder default order", rows, updatedAt: "2026-10-16T00:00:00Z" };

    it("offers templates kept in the system and reviews one without any file", async () => {
      templates.listOrderTemplates.mockResolvedValue([savedTemplate]);
      await open();

      fireEvent.change(await screen.findByLabelText("Saved templates"), { target: { value: "5" } });

      expect(await screen.findByText(/2 products in 2 categories/)).toBeTruthy();
      expect(xlsx.readXlsxColumnA).not.toHaveBeenCalled();
      // Already saved, so there is nothing to save again.
      expect(screen.queryByRole("button", { name: "Save template" })).toBeNull();
    });

    it("saves a file's template under a name so it is still there after a reset", async () => {
      xlsx.readXlsxColumnA.mockResolvedValue([
        { name: "OCT 8", cells: [cell(5, "CLASS A (LITER)", 16), cell(6, "SWEET A", 11)] },
        { name: "OCT 9", cells: [cell(5, "CLASS A (LITER)", 16), cell(6, "SWEET A", 11), cell(7, "MORE", 11)] },
      ]);
      templates.saveOrderTemplate.mockResolvedValue({ id: 9, name: "encoder order - OCT 8", rows: [], updatedAt: "" });
      await open();
      pick(file());

      const name = (await screen.findByLabelText("Template name")) as HTMLInputElement;
      expect(name.value).toBe("encoder order - OCT 8"); // file name + the sheet it was read from
      fireEvent.click(screen.getByRole("button", { name: "Save template" }));

      await waitFor(() => expect(templates.saveOrderTemplate).toHaveBeenCalledWith("encoder order - OCT 8", [{ category: "CLASS A (LITER)", name: "SWEET A" }]));
      // It is now in the saved list and selected.
      expect(((await screen.findByLabelText("Saved templates")) as HTMLSelectElement).value).toBe("9");
      expect(screen.queryByLabelText("Template name")).toBeNull();
    });

    it("deletes a saved template after a confirm", async () => {
      templates.listOrderTemplates.mockResolvedValue([savedTemplate]);
      templates.deleteOrderTemplate.mockResolvedValue({ deleted: true });
      await open();
      fireEvent.change(await screen.findByLabelText("Saved templates"), { target: { value: "5" } });

      fireEvent.click(await screen.findByRole("button", { name: "Delete saved template" }));
      expect(templates.deleteOrderTemplate).not.toHaveBeenCalled();
      fireEvent.click(await screen.findByRole("button", { name: "Delete" }));

      await waitFor(() => expect(templates.deleteOrderTemplate).toHaveBeenCalledWith(5));
      await waitFor(() => expect(screen.queryByLabelText("Saved templates")).toBeNull());
    });
  });
});
