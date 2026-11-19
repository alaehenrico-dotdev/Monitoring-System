import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";

const api = vi.hoisted(() => ({ listProducts: vi.fn(), reorderProducts: vi.fn(), syncProducts: vi.fn(), createProduct: vi.fn(), updateProduct: vi.fn() }));
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
    const inactive = { ...product(7, "Old Soy", "Class A (Liter)", "AFP007"), isActive: false };
    const inactiveFish = { ...product(8, "Old Fish", "Premium (Liter)", null), isActive: false };
    const withInactive = (opts?: { includeInactive?: boolean }) =>
      Promise.resolve([product(1, "Special", "Premium (Liter)"), product(2, "Sweet A", "Class A (Liter)"), product(3, "Mystery", "Class A (Liter)"), ...(opts?.includeInactive ? [inactive, inactiveFish] : [])]);
    const openForm = async () => {
      await open();
      fireEvent.click(screen.getByRole("button", { name: "Add product" }));
      return await screen.findByRole("form", { name: "Add product" });
    };
    const form = () => within(screen.getByRole("form", { name: "Add product" }));
    const submit = () => fireEvent.click(form().getByRole("button", { name: /^Add (product|\d+ products)$/ }));
    const tick = (label: string) => fireEvent.click(form().getByRole("checkbox", { name: label }));
    const listed = () => within(screen.getByRole("list", { name: "SKUs to add" })).queryAllByRole("checkbox").map((c) => c.getAttribute("aria-label"));

    it("lists every SKU that is not in the list, inactive ones included, grouped by category", async () => {
      api.listProducts.mockImplementation(withInactive);
      await openForm();
      await screen.findByRole("list", { name: "SKUs to add" });
      expect(listed()).toEqual(["AFP007 · Old Soy", "no SKU · Old Fish"]);
      expect(within(screen.getByRole("list", { name: "SKUs to add" })).getAllByText("inactive")).toHaveLength(2);
      expect([...form().getByRole("combobox", { name: "Category" }).querySelectorAll("option")].map((o) => o.textContent)).toEqual([
        "All categories (2)",
        "Class A (Liter) (1)",
        "Premium (Liter) (1)",
      ]);
    });

    it("shows only the chosen category's products", async () => {
      api.listProducts.mockImplementation(withInactive);
      await openForm();
      await screen.findByRole("list", { name: "SKUs to add" });
      fireEvent.change(form().getByRole("combobox", { name: "Category" }), { target: { value: "Premium (Liter)" } });
      expect(listed()).toEqual(["no SKU · Old Fish"]);
    });

    it("narrows the list by name, SKU or category, and says when nothing matches", async () => {
      api.listProducts.mockImplementation(withInactive);
      await openForm();
      await screen.findByRole("list", { name: "SKUs to add" });
      fireEvent.change(form().getByLabelText("Search SKUs"), { target: { value: "afp007" } });
      expect(listed()).toEqual(["AFP007 · Old Soy"]);
      fireEvent.change(form().getByLabelText("Search SKUs"), { target: { value: "zzz" } });
      expect(listed()).toEqual([]);
      expect(screen.getByText("No SKU matches")).toBeTruthy();
    });

    it("has no way to type a new product here", async () => {
      api.listProducts.mockImplementation(withInactive);
      await openForm();
      await screen.findByRole("list", { name: "SKUs to add" });
      expect(screen.queryByLabelText("Product name")).toBeNull();
      expect(api.createProduct).not.toHaveBeenCalled();
    });

    it("brings a ticked SKU back, shows it after the rest of its category, and leaves its place to be saved", async () => {
      api.listProducts.mockImplementation(withInactive);
      const back = { ...inactive, isActive: true };
      api.updateProduct.mockResolvedValue(back);
      await openForm();
      await screen.findByRole("list", { name: "SKUs to add" });
      tick("AFP007 · Old Soy");
      // After the switch-on the server lists it at the place it had before it was switched off.
      api.listProducts.mockResolvedValue([back, product(1, "Special", "Premium (Liter)"), product(2, "Sweet A", "Class A (Liter)"), product(3, "Mystery", "Class A (Liter)")]);
      submit();

      await waitFor(() => expect(api.updateProduct).toHaveBeenCalledWith(7, { isActive: true }));
      await waitFor(() => expect(names()).toEqual(["Special", "Sweet A", "Mystery", "Old Soy"]));
      // Its saved place differs from where it is shown, so the order has a change to save.
      await waitFor(() => expect((screen.getByRole("button", { name: "Save order" }) as HTMLButtonElement).disabled).toBe(false));
      expect(screen.queryByRole("form", { name: "Add product" })).toBeNull();
    });

    it("adds several at once, each after its own category, with one select-all for what is shown", async () => {
      api.listProducts.mockImplementation(withInactive);
      api.updateProduct.mockImplementation(async (id: number) => ({ ...(id === 7 ? inactive : inactiveFish), isActive: true }));
      await openForm();
      await screen.findByRole("list", { name: "SKUs to add" });
      fireEvent.click(form().getByRole("checkbox", { name: "Select all shown" }));
      expect(form().getByRole("button", { name: "Add 2 products" })).toBeTruthy();
      submit();

      await waitFor(() => expect(api.updateProduct).toHaveBeenCalledTimes(2));
      await waitFor(() => expect(names()).toEqual(["Special", "Old Fish", "Sweet A", "Mystery", "Old Soy"]));
      expect(screen.queryByRole("form", { name: "Add product" })).toBeNull();
    });

    it("keeps reordering in progress when SKUs are brought back", async () => {
      api.listProducts.mockImplementation(withInactive);
      api.updateProduct.mockResolvedValue({ ...inactive, isActive: true });
      await openForm();
      fireEvent.click(screen.getByRole("button", { name: "Move Sweet A up" })); // an unsaved change
      await screen.findByRole("list", { name: "SKUs to add" });
      tick("AFP007 · Old Soy");
      submit();
      await waitFor(() => expect(names()).toEqual(["Sweet A", "Special", "Mystery", "Old Soy"]));
    });

    it("asks for something to be ticked", async () => {
      api.listProducts.mockImplementation(withInactive);
      await openForm();
      await screen.findByRole("list", { name: "SKUs to add" });
      submit();
      expect((await screen.findByRole("alert")).textContent).toBe("Tick at least one product to add.");
      expect(api.updateProduct).not.toHaveBeenCalled();
    });

    it("when one of several is refused, keeps the ones that were added and the form open for the rest", async () => {
      api.listProducts.mockImplementation(withInactive);
      api.updateProduct.mockImplementation(async (id: number) => {
        if (id === 8) throw new Error("Not allowed");
        return { ...inactive, isActive: true };
      });
      await openForm();
      await screen.findByRole("list", { name: "SKUs to add" });
      fireEvent.click(form().getByRole("checkbox", { name: "Select all shown" }));
      submit();

      expect(await screen.findByText("Old Fish: Not allowed")).toBeTruthy();
      await waitFor(() => expect(names()).toContain("Old Soy"));
      // The one that went in is no longer offered; the refused one stays ticked to try again.
      expect(listed()).toEqual(["no SKU · Old Fish"]);
      expect((form().getByRole("checkbox", { name: "no SKU · Old Fish" }) as HTMLInputElement).checked).toBe(true);
    });

    it("says so, and points to the SKUs tab, when every SKU is already in the list", async () => {
      await openForm();
      expect(await screen.findByText(/Every SKU in the system is already in the list/)).toBeTruthy();
      expect(screen.getByText(/created on the SKUs tab/)).toBeTruthy();
      expect((form().getByRole("button", { name: "Add product" }) as HTMLButtonElement).disabled).toBe(true);
    });

    it("can be cancelled without changing anything", async () => {
      api.listProducts.mockImplementation(withInactive);
      await openForm();
      fireEvent.click(form().getByRole("button", { name: "Cancel" }));
      expect(screen.queryByRole("form", { name: "Add product" })).toBeNull();
      expect(api.updateProduct).not.toHaveBeenCalled();
    });

    it("is the template's own while a template is being reviewed, not the order list's", async () => {
      xlsx.readXlsxColumnA.mockResolvedValue([{ name: "OCT 8", cells: [cell(1, "CLASS A (LITER)", 16), cell(2, "SWEET A", 11)] }]);
      await open();
      pick(file());
      await screen.findByText(/1 product in 1 category/);
      fireEvent.click(screen.getByRole("button", { name: "Add product" }));
      expect(await screen.findByRole("form", { name: "Add product to the template" })).toBeTruthy();
      expect(screen.queryByRole("form", { name: "Add product" })).toBeNull();
    });
  });

  describe("add product to the template", () => {
    // The system has five SKUs; the template lists two of them. Old Soy and Old Fish are inactive.
    const oldSoy = { ...product(7, "Old Soy", "Class A (Liter)", "AFP007"), isActive: false };
    const oldFish = { ...product(8, "Old Fish", "Premium (Liter)", null), isActive: false };
    const everything = (opts?: { includeInactive?: boolean }) =>
      Promise.resolve([product(1, "Special", "Premium (Liter)"), product(2, "Sweet A", "Class A (Liter)"), product(3, "Mystery", "Class A (Liter)"), ...(opts?.includeInactive ? [oldSoy, oldFish] : [])]);
    const templateSheet = () =>
      xlsx.readXlsxColumnA.mockResolvedValue([{ name: "OCT 8", cells: [cell(5, "CLASS A (LITER)", 16), cell(6, "SWEET A", 11), cell(7, "PREMIUM (LITER)", 16), cell(8, "SPECIAL", 11)] }]);
    const openChooser = async () => {
      api.listProducts.mockImplementation(everything);
      templateSheet();
      await open();
      pick(file());
      await screen.findByText(/2 products in 2 categories/);
      fireEvent.click(screen.getByRole("button", { name: "Add product" }));
      return await screen.findByRole("form", { name: "Add product to the template" });
    };
    const chooser = () => within(screen.getByRole("form", { name: "Add product to the template" }));
    const listed = () => within(screen.getByRole("list", { name: "SKUs to add" })).queryAllByRole("checkbox").map((c) => c.getAttribute("aria-label"));
    const tick = (label: string) => fireEvent.click(chooser().getByRole("checkbox", { name: label }));
    const add = () => fireEvent.click(chooser().getByRole("button", { name: /^Add (product|\d+ products)$/ }));

    it("offers every SKU the template does not list, active and inactive, and none that it lists", async () => {
      await openChooser();
      await screen.findByRole("list", { name: "SKUs to add" });
      // Mystery is active but not in the template; the two inactive ones are offered too; Sweet A and Special are in it.
      expect(listed()).toEqual(["no SKU · Mystery", "AFP007 · Old Soy", "no SKU · Old Fish"]);
      expect([...chooser().getByRole("combobox", { name: "Category" }).querySelectorAll("option")].map((o) => o.textContent)).toEqual([
        "All categories (3)",
        "Class A (Liter) (2)",
        "Premium (Liter) (1)",
      ]);
    });

    it("adds an active SKU as a row of the template under its category, and applies it with the rest", async () => {
      await openChooser();
      await screen.findByRole("list", { name: "SKUs to add" });
      tick("no SKU · Mystery");
      add();

      // The chooser closes, the row sits after the template's last Class A row, and the summary counts it.
      await waitFor(() => expect(screen.queryByRole("form", { name: "Add product to the template" })).toBeNull());
      expect(screen.getByText(/3 products in 2 categories/)).toBeTruthy();
      expect(screen.getByText(/1 added by you\./)).toBeTruthy();
      expect(screen.getByText("added by you")).toBeTruthy();

      fireEvent.click(screen.getByRole("button", { name: "Apply template" }));
      await waitFor(() =>
        expect(api.syncProducts).toHaveBeenCalledWith(
          [
            { category: "Class A (Liter)", name: "SWEET A", productId: 2 },
            { category: "Class A (Liter)", name: "Mystery", productId: 3 },
            { category: "Premium (Liter)", name: "SPECIAL", productId: 1 },
          ],
          { deactivateUnlisted: false },
        ),
      );
    });

    it("adds inactive SKUs as the SKUs themselves (never new duplicates), which the sync switches back on", async () => {
      api.syncProducts.mockResolvedValue({ created: 0, moved: 0, renamed: 0, reactivated: 2, reordered: 4, total: 4 });
      await openChooser();
      await screen.findByRole("list", { name: "SKUs to add" });
      tick("AFP007 · Old Soy");
      tick("no SKU · Old Fish");
      expect(chooser().getByRole("button", { name: "Add 2 products" })).toBeTruthy();
      add();

      await screen.findAllByText(/inactive, switched back on when applied/);
      // Chosen on purpose, so neither is offered as "an existing product?" or flagged as a stray duplicate.
      expect(screen.queryByLabelText("Is Old Soy an existing product?")).toBeNull();
      expect(screen.queryByLabelText("Is Old Fish an existing product?")).toBeNull();
      expect(screen.queryByText("NEW")).toBeNull();
      fireEvent.click(screen.getByRole("button", { name: "Apply template" }));
      await waitFor(() =>
        expect(api.syncProducts).toHaveBeenCalledWith(
          [
            { category: "Class A (Liter)", name: "SWEET A", productId: 2 },
            { category: "Class A (Liter)", name: "Old Soy", productId: 7 },
            { category: "Premium (Liter)", name: "SPECIAL", productId: 1 },
            { category: "Premium (Liter)", name: "Old Fish", productId: 8 },
          ],
          { deactivateUnlisted: false },
        ),
      );
    });

    it("no longer offers what was added, and can take it out of the template again", async () => {
      await openChooser();
      await screen.findByRole("list", { name: "SKUs to add" });
      tick("no SKU · Mystery");
      add();
      await screen.findByText("added by you");

      fireEvent.click(screen.getByRole("button", { name: "Add product" }));
      await screen.findByRole("list", { name: "SKUs to add" });
      expect(listed()).toEqual(["AFP007 · Old Soy", "no SKU · Old Fish"]);
      fireEvent.click(chooser().getByRole("button", { name: "Cancel" }));

      fireEvent.click(screen.getByRole("button", { name: "Remove Mystery from the template" }));
      expect(screen.getByText(/2 products in 2 categories/)).toBeTruthy();
      expect(screen.queryByText("added by you")).toBeNull();
    });

    it("says so when the template already lists every SKU", async () => {
      api.listProducts.mockResolvedValue([product(1, "Special", "Premium (Liter)"), product(2, "Sweet A", "Class A (Liter)")]);
      templateSheet();
      await open();
      pick(file());
      await screen.findByText(/2 products in 2 categories/);
      fireEvent.click(screen.getByRole("button", { name: "Add product" }));
      expect(await screen.findByText(/Every SKU in the system is already in this template/)).toBeTruthy();
    });

    it("keeps a saved template up to date: applying saves it again with the added rows", async () => {
      const savedRows = [{ category: "CLASS A (LITER)", name: "SWEET A" }, { category: "PREMIUM (LITER)", name: "SPECIAL" }];
      templates.listOrderTemplates.mockResolvedValue([{ id: 5, name: "Encoder default order", rows: savedRows, updatedAt: "2026-10-16T00:00:00Z" }]);
      api.listProducts.mockImplementation(everything);
      templates.saveOrderTemplate.mockResolvedValue({ id: 5, name: "Encoder default order", rows: [], updatedAt: "" });
      await open();
      fireEvent.change(await screen.findByLabelText("Saved templates"), { target: { value: "5" } });
      await screen.findByText(/2 products in 2 categories/);
      fireEvent.click(screen.getByRole("button", { name: "Add product" }));
      await screen.findByRole("list", { name: "SKUs to add" });
      tick("no SKU · Mystery");
      add();
      fireEvent.click(await screen.findByRole("button", { name: "Apply template" }));

      await waitFor(() => expect(api.syncProducts).toHaveBeenCalled());
      await waitFor(() =>
        expect(templates.saveOrderTemplate).toHaveBeenCalledWith("Encoder default order", [
          { category: "CLASS A (LITER)", name: "SWEET A" },
          { category: "Class A (Liter)", name: "Mystery" },
          { category: "PREMIUM (LITER)", name: "SPECIAL" },
        ]),
      );
    });

    it("leaves a saved template alone when nothing was added", async () => {
      const savedRows = [{ category: "CLASS A (LITER)", name: "SWEET A" }, { category: "PREMIUM (LITER)", name: "SPECIAL" }];
      templates.listOrderTemplates.mockResolvedValue([{ id: 5, name: "Encoder default order", rows: savedRows, updatedAt: "" }]);
      api.listProducts.mockImplementation(everything);
      await open();
      fireEvent.change(await screen.findByLabelText("Saved templates"), { target: { value: "5" } });
      await screen.findByText(/2 products in 2 categories/);
      fireEvent.click(screen.getByRole("button", { name: "Apply template" }));
      await waitFor(() => expect(api.syncProducts).toHaveBeenCalled());
      expect(templates.saveOrderTemplate).not.toHaveBeenCalled();
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
