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
