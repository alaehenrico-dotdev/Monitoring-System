import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";

const api = vi.hoisted(() => ({ listProducts: vi.fn(), reorderProducts: vi.fn(), syncProducts: vi.fn(), createProduct: vi.fn() }));
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
  templates.saveOrderTemplate.mockResolvedValue({ id: 1, name: "x", rows: [], updatedAt: "" });
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
    expect(screen.getByText(/1 other product not in the template stay where they are, beside their own category/)).toBeTruthy();
    expect(screen.getByText("NEW")).toBeTruthy();
    expect(screen.queryByText("Mystery")).toBeNull();
    expect(api.syncProducts).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "Apply template" }));

    // Nothing is hidden unless asked, so there is nothing to confirm.
    await waitFor(() =>
      expect(api.syncProducts).toHaveBeenCalledWith(
        [
          { category: "Class A (Liter)", name: "SWEET A", productId: 2 },
          { category: "Premium (Liter)", name: "SPECIAL", productId: 1 },
          { category: "Premium (Liter)", name: "GONE" },
        ],
        { deactivateUnlisted: false },
      ),
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
      expect(api.syncProducts).toHaveBeenCalledWith(
        [
          { category: "Class A (Liter)", name: "SWEET A", productId: 1 },
          { category: "Class A (Liter)", name: "PALM OIL", productId: 2 },
        ],
        { deactivateUnlisted: false }, // every product is in the template, so nothing to hide
      ),
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
      expect(api.syncProducts).toHaveBeenCalledWith(
        [
          { category: "Class A (Liter)", name: "SWEET A", productId: 1 },
          { category: "Class A (Liter)", name: "PALM OIL", productId: 2, mergeFromId: 3 },
        ],
        { deactivateUnlisted: false },
      ),
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

  it("never lets another row of the template take the product that is being merged away", async () => {
    // "PALM OIL" is in two categories of the template but only one no-SKU product exists
    // (matched to the Liter row). Merging that row away must not hand the same product to the
    // Gallon row, which the server refuses: it is being deleted.
    api.listProducts.mockResolvedValue([
      product(1, "Sweet A", "Class A (Liter)", "AFP001"),
      product(2, "Palm Oil Liter", "New Products", "AFP069"),
      product(3, "PALM OIL", "Class A (Liter)"),
    ]);
    xlsx.readXlsxColumnA.mockResolvedValue([
      {
        name: "OCT 8",
        cells: [cell(5, "CLASS A -(LITER)", 16), cell(6, "PALM OIL", 11), cell(7, "CLASS A (GALLON)", 16), cell(8, "PALM OIL", 11)],
      },
    ]);
    await open();
    pick(file());
    await screen.findByText(/2 products in 2 categories/);

    fireEvent.change(screen.getAllByLabelText("Is PALM OIL an existing product?")[0], { target: { value: "2" } });
    fireEvent.click(screen.getByRole("button", { name: "Apply template & merge 1" }));
    fireEvent.click(await screen.findByRole("button", { name: "Merge and apply" }));

    await waitFor(() =>
      expect(api.syncProducts).toHaveBeenCalledWith(
        [
          { category: "Class A (Liter)", name: "PALM OIL", productId: 2, mergeFromId: 3 },
          // Its own new product - not product 3, which is being merged away.
          { category: "CLASS A (GALLON)", name: "PALM OIL" },
        ],
        { deactivateUnlisted: false }, // "Sweet A" is not in this template, and stays
      ),
    );
  });

  describe("products the template does not list", () => {
    const readTemplate = async () => {
      xlsx.readXlsxColumnA.mockResolvedValue([
        { name: "OCT 8", cells: [cell(5, "CLASS A (LITER)", 16), cell(6, "SWEET A", 11), cell(7, "PREMIUM (LITER)", 16), cell(8, "SPECIAL", 11)] },
      ]);
      await open();
      pick(file());
      await screen.findByText(/2 products in 2 categories/);
    };

    it("keeps them by default, and offers to hide them as an option, saying which they are", async () => {
      await readTemplate();

      const box = screen.getByLabelText(/Also hide the 1 product that is not in the template/) as HTMLInputElement;
      expect(box.checked).toBe(false);
      fireEvent.click(screen.getByText("Which products?"));
      expect(screen.getByText(/Mystery · Class A \(Liter\)/)).toBeTruthy();
    });

    it("applies without hiding anything and without a confirm, unless the box is ticked", async () => {
      await readTemplate();

      fireEvent.click(screen.getByRole("button", { name: "Apply template" }));

      await waitFor(() => expect(api.syncProducts).toHaveBeenCalledWith(expect.any(Array), { deactivateUnlisted: false }));
    });

    it("hides them only when the box is ticked, after a confirm", async () => {
      await readTemplate();
      fireEvent.click(screen.getByLabelText(/Also hide the 1 product that is not in the template/));
      expect(screen.getByText(/1 other product not in the template will be hidden/)).toBeTruthy();

      fireEvent.click(screen.getByRole("button", { name: "Apply template" }));
      expect(api.syncProducts).not.toHaveBeenCalled();
      fireEvent.click(await screen.findByRole("button", { name: "Hide and apply" }));

      await waitFor(() => expect(api.syncProducts).toHaveBeenCalledWith(expect.any(Array), { deactivateUnlisted: true }));
    });

    it("a product linked to a template row is no longer one of them", async () => {
      api.listProducts.mockResolvedValue([product(1, "Sweet A", "Class A (Liter)", "AFP001"), product(2, "Palm Oil Liter", "New Products", "AFP069")]);
      xlsx.readXlsxColumnA.mockResolvedValue([{ name: "OCT 8", cells: [cell(5, "CLASS A (LITER)", 16), cell(6, "SWEET A", 11), cell(7, "PALM OIL", 11)] }]);
      await open();
      pick(file());
      await screen.findByText(/2 products in 1 category/);
      expect(screen.getByLabelText(/Also hide the 1 product that is not in the template/)).toBeTruthy(); // Palm Oil Liter

      fireEvent.change(screen.getByLabelText("Is PALM OIL an existing product?"), { target: { value: "2" } });

      expect(screen.queryByLabelText(/that is not in the template/)).toBeNull();
    });
  });

  describe("add product", () => {
    const openForm = async () => {
      await open();
      fireEvent.click(screen.getByRole("button", { name: "Add product" }));
      return await screen.findByRole("form", { name: "Add product" });
    };
    const fillName = (value: string) => fireEvent.change(screen.getByLabelText("Product name"), { target: { value } });
    const submit = () => fireEvent.click(within(screen.getByRole("form", { name: "Add product" })).getByRole("button", { name: "Add product" }));

    it("adds a product to an existing category, filling in its unit, and shows it where the server placed it", async () => {
      api.createProduct.mockResolvedValue(product(9, "More Sweet A", "Class A (Liter)", null));
      await openForm();

      fillName("More Sweet A");
      fireEvent.change(screen.getByLabelText("Category"), { target: { value: "Class A (Liter)" } });
      expect((screen.getByLabelText("Unit") as HTMLInputElement).value).toBe("pc"); // the unit that category already uses
      submit();

      await waitFor(() => expect(api.createProduct).toHaveBeenCalledWith({ sku: undefined, name: "More Sweet A", category: "Class A (Liter)", unit: "pc" }));
      // Right after the last product of its category - and it is saved, so the order is not "changed".
      await waitFor(() => expect(names()).toEqual(["Special", "Sweet A", "Mystery", "More Sweet A"]));
      expect((screen.getByRole("button", { name: "Save order" }) as HTMLButtonElement).disabled).toBe(true);
      expect(screen.queryByRole("form", { name: "Add product" })).toBeNull();
    });

    it("can start a new category, which goes at the end", async () => {
      api.createProduct.mockResolvedValue(product(9, "Chili Oil", "Oils", "AFP090"));
      await openForm();

      fillName("Chili Oil");
      fireEvent.change(screen.getByLabelText("SKU code (optional)"), { target: { value: " AFP090 " } });
      fireEvent.change(screen.getByLabelText("Category"), { target: { value: "__new__" } });
      fireEvent.change(await screen.findByLabelText("New category name"), { target: { value: "Oils" } });
      fireEvent.change(screen.getByLabelText("Unit"), { target: { value: "Bottle" } });
      submit();

      await waitFor(() => expect(api.createProduct).toHaveBeenCalledWith({ sku: "AFP090", name: "Chili Oil", category: "Oils", unit: "Bottle" }));
      await waitFor(() => expect(names()).toEqual(["Special", "Sweet A", "Mystery", "Chili Oil"]));
    });

    it("keeps reordering in progress when a product is added", async () => {
      api.createProduct.mockResolvedValue(product(9, "More Sweet A", "Class A (Liter)", null));
      await openForm();
      fireEvent.click(screen.getByRole("button", { name: "Move Sweet A up" })); // an unsaved change

      fillName("More Sweet A");
      fireEvent.change(screen.getByLabelText("Category"), { target: { value: "Class A (Liter)" } });
      submit();

      await waitFor(() => expect(names()).toEqual(["Sweet A", "Special", "Mystery", "More Sweet A"]));
      expect((screen.getByRole("button", { name: "Save order" }) as HTMLButtonElement).disabled).toBe(false);
    });

    it("asks for name, category and unit, and shows the server's message when it refuses", async () => {
      await openForm();
      submit();
      expect((await screen.findByRole("alert")).textContent).toBe("Name, category and unit are required.");
      expect(api.createProduct).not.toHaveBeenCalled();

      api.createProduct.mockRejectedValue(new Error("A product with that SKU already exists"));
      fillName("Dup");
      fireEvent.change(screen.getByLabelText("Category"), { target: { value: "Class A (Liter)" } });
      submit();
      expect((await screen.findByText("A product with that SKU already exists"))).toBeTruthy();
    });

    it("is not offered while a template is being reviewed", async () => {
      xlsx.readXlsxColumnA.mockResolvedValue([{ name: "OCT 8", cells: [cell(1, "CLASS A (LITER)", 16), cell(2, "SWEET A", 11)] }]);
      await open();
      pick(file());
      await screen.findByText(/1 product in 1 category/);
      expect(screen.queryByRole("button", { name: "Add product" })).toBeNull();
    });
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

    const readTwoSheets = async () => {
      xlsx.readXlsxColumnA.mockResolvedValue([
        { name: "OCT 8", cells: [cell(5, "CLASS A (LITER)", 16), cell(6, "SWEET A", 11)] },
        { name: "OCT 9", cells: [cell(5, "CLASS A (LITER)", 16), cell(6, "SWEET A", 11), cell(7, "MORE", 11)] },
      ]);
      await open();
      pick(file());
      await screen.findByText(/MORE|SWEET A/);
    };

    it("has no separate Save template step: the review is all there is", async () => {
      await readTwoSheets();
      expect(screen.queryByRole("button", { name: "Save template" })).toBeNull();
      expect(screen.queryByLabelText("Template name")).toBeNull();
    });

    it("applying a template read from a file also saves it, named after the file and sheet", async () => {
      templates.saveOrderTemplate.mockResolvedValue({ id: 9, name: "encoder order - OCT 8", rows: [], updatedAt: "" });
      await readTwoSheets();
      fireEvent.click(screen.getByRole("button", { name: /Apply template/ }));
      // "Mystery" is not in the template and stays, so there is nothing to confirm.

      await waitFor(() => expect(api.syncProducts).toHaveBeenCalled());
      await waitFor(() => expect(templates.saveOrderTemplate).toHaveBeenCalledWith("encoder order - OCT 8", [{ category: "CLASS A (LITER)", name: "SWEET A" }]));
      // Saved after the order was applied, never instead of it.
      expect(api.syncProducts.mock.invocationCallOrder[0]).toBeLessThan(templates.saveOrderTemplate.mock.invocationCallOrder[0]);
    });

    it("a template that could not be saved does not undo or fail the apply", async () => {
      templates.saveOrderTemplate.mockRejectedValue(new Error("down"));
      await readTwoSheets();
      fireEvent.click(screen.getByRole("button", { name: /Apply template/ }));

      await waitFor(() => expect(templates.saveOrderTemplate).toHaveBeenCalled());
      // The dialog closed as for any successful apply, and no error is shown.
      await waitFor(() => expect(screen.queryByText("Arrange product order")).toBeNull());
      expect(screen.queryByRole("alert")).toBeNull();
    });

    it("applying a template that is already saved does not save it again", async () => {
      templates.listOrderTemplates.mockResolvedValue([savedTemplate]);
      await open();
      fireEvent.change(await screen.findByLabelText("Saved templates"), { target: { value: "5" } });
      await screen.findByText(/2 products in 2 categories/);

      fireEvent.click(screen.getByRole("button", { name: /Apply template/ }));

      await waitFor(() => expect(api.syncProducts).toHaveBeenCalled());
      expect(templates.saveOrderTemplate).not.toHaveBeenCalled();
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
