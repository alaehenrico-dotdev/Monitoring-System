import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { ProductsAdminPage } from "./ProductsAdminPage";

const api = vi.hoisted(() => ({ listProducts: vi.fn(), updateProduct: vi.fn(), createProduct: vi.fn(), deactivateProduct: vi.fn(), deleteProductPermanently: vi.fn() }));
vi.mock("../api/products", () => api);
vi.mock("../context/RealtimeContext", () => ({ useRealtimeVersion: () => 0 }));
vi.mock("../components/PageHeader", () => ({ PageHeader: ({ children }: { children?: React.ReactNode }) => <div>{children}</div> }));

const product = (over: Record<string, unknown> = {}) => ({
  id: 1,
  sku: "AFP007",
  name: "SWEET A",
  category: "Class A",
  unit: "Liter",
  isActive: true,
  lowStockThreshold: null,
  sortOrder: 1,
  ...over,
});

async function setup() {
  api.listProducts.mockResolvedValue([product()]);
  render(
    <MemoryRouter>
      <ProductsAdminPage />
    </MemoryRouter>,
  );
  return (await screen.findByLabelText("SKU code of SWEET A")) as HTMLInputElement;
}

beforeEach(() => vi.clearAllMocks());

describe("adding a SKU: the category's products", () => {
  const several = [
    product({ id: 1, sku: "AFP007", name: "SWEET A", category: "Class A", sortOrder: 1 }),
    product({ id: 2, sku: "AFP008", name: "SPECIAL A", category: "Class A", sortOrder: 2 }),
    product({ id: 3, sku: null, name: "OLD SOY", category: "Class A", isActive: false, sortOrder: 3 }),
    product({ id: 4, sku: "AFP020", name: "FISH SAUCE", category: "Premium", sortOrder: 4 }),
  ];
  async function openAddForm() {
    api.listProducts.mockResolvedValue(several);
    render(
      <MemoryRouter>
        <ProductsAdminPage />
      </MemoryRouter>,
    );
    await screen.findByLabelText("SKU code of SWEET A");
  }

  it("shows nothing until a category is chosen", async () => {
    await openAddForm();
    expect(screen.queryByRole("region", { name: /Products in/ })).toBeNull();
  });

  it("lists the chosen category's products, inactive ones marked, and says where the new one goes", async () => {
    await openAddForm();
    fireEvent.change(screen.getByLabelText("Category"), { target: { value: "Class A" } });
    const box = await screen.findByRole("region", { name: "Products in Class A" });
    expect(box.textContent).toContain("Already in Class A (3)");
    expect(box.textContent).toContain("AFP007 · SWEET A");
    expect(box.textContent).toContain("AFP008 · SPECIAL A");
    expect(box.textContent).toContain("no SKU · OLD SOY (inactive)");
    expect(box.textContent).not.toContain("FISH SAUCE");
    expect(box.textContent).toContain("A new product here goes after OLD SOY");
  });

  it("follows the category chosen", async () => {
    await openAddForm();
    fireEvent.change(screen.getByLabelText("Category"), { target: { value: "Premium" } });
    const box = await screen.findByRole("region", { name: "Products in Premium" });
    expect(box.textContent).toContain("Already in Premium (1)");
    expect(box.textContent).toContain("AFP020 · FISH SAUCE");
  });

  it("is not shown for a new category, which has no products yet", async () => {
    await openAddForm();
    fireEvent.change(screen.getByLabelText("Category"), { target: { value: "__new__" } });
    fireEvent.change(await screen.findByLabelText("New category name"), { target: { value: "Oils" } });
    expect(screen.queryByRole("region", { name: /Products in/ })).toBeNull();
  });
});

describe("editing a SKU code", () => {
  it("saves the new code on Enter/blur, hyphens included", async () => {
    const input = await setup();
    api.updateProduct.mockResolvedValue(product({ sku: "AFP-007" }));
    fireEvent.change(input, { target: { value: " AFP-007 " } });
    fireEvent.blur(input);
    await waitFor(() => expect(api.updateProduct).toHaveBeenCalledWith(1, { sku: "AFP-007" }));
    await waitFor(() => expect(input.value).toBe("AFP-007"));
  });

  it("clears the SKU when the cell is emptied", async () => {
    const input = await setup();
    api.updateProduct.mockResolvedValue(product({ sku: null }));
    fireEvent.change(input, { target: { value: "" } });
    fireEvent.blur(input);
    await waitFor(() => expect(api.updateProduct).toHaveBeenCalledWith(1, { sku: null }));
  });

  it("sends nothing when the code is unchanged, and Escape puts the old one back", async () => {
    const input = await setup();
    fireEvent.blur(input);
    fireEvent.change(input, { target: { value: "XYZ" } });
    fireEvent.keyDown(input, { key: "Escape" });
    expect(input.value).toBe("AFP007");
    fireEvent.blur(input);
    expect(api.updateProduct).not.toHaveBeenCalled();
  });

  it("shows the server's message and keeps the old code when the SKU is taken", async () => {
    const input = await setup();
    api.updateProduct.mockRejectedValue(new Error("SKU AFP-008 is already used by SWEET B."));
    fireEvent.change(input, { target: { value: "AFP-008" } });
    fireEvent.blur(input);
    expect(await screen.findByText(/already used by SWEET B/)).toBeTruthy();
    await waitFor(() => expect(input.value).toBe("AFP007"));
  });
});

describe("row actions menu", () => {
  async function openMenu() {
    await setup();
    fireEvent.click(screen.getByRole("button", { name: "Actions for SWEET A" }));
  }

  it("lists Edit, Update SKU code, Deactivate and Delete", async () => {
    await openMenu();
    for (const name of [/Edit/, /Update SKU code/, /Deactivate/, /Delete/]) expect(await screen.findByRole("menuitem", { name })).toBeTruthy();
  });

  it("Update SKU code jumps to that row's SKU cell", async () => {
    await openMenu();
    fireEvent.click(await screen.findByRole("menuitem", { name: /Update SKU code/ }));
    expect(document.activeElement).toBe(screen.getByLabelText("SKU code of SWEET A"));
  });

  it("Edit saves only what changed", async () => {
    await openMenu();
    api.updateProduct.mockResolvedValue(product({ name: "SWEET AA" }));
    fireEvent.click(await screen.findByRole("menuitem", { name: /Edit/ }));
    const name = (await screen.findByDisplayValue("SWEET A")) as HTMLInputElement;
    fireEvent.change(name, { target: { value: "sweet aa" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(api.updateProduct).toHaveBeenCalledWith(1, { name: "sweet aa" }));
  });

  it("Delete asks first, then removes the row", async () => {
    await openMenu();
    api.deleteProductPermanently.mockResolvedValue({ id: 1 });
    fireEvent.click(await screen.findByRole("menuitem", { name: /Delete/ }));
    expect(api.deleteProductPermanently).not.toHaveBeenCalled();
    fireEvent.click(await screen.findByRole("button", { name: "Delete" }));
    await waitFor(() => expect(api.deleteProductPermanently).toHaveBeenCalledWith(1));
    await waitFor(() => expect(screen.queryByLabelText("SKU code of SWEET A")).toBeNull());
  });

  it("shows the server's reason when a used product cannot be deleted", async () => {
    await openMenu();
    api.deleteProductPermanently.mockRejectedValue(new Error("SWEET A has stock history (3 records), so it cannot be deleted. Deactivate it instead - its history stays."));
    fireEvent.click(await screen.findByRole("menuitem", { name: /Delete/ }));
    fireEvent.click(await screen.findByRole("button", { name: "Delete" }));
    expect(await screen.findByText(/Deactivate it instead/)).toBeTruthy();
    expect(screen.getByLabelText("SKU code of SWEET A")).toBeTruthy();
  });
});
