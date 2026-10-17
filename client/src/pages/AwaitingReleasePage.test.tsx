import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ReactNode } from "react";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { AwaitingReleasePage } from "./AwaitingReleasePage";

const api = vi.hoisted(() => ({
  listPendingReleases: vi.fn(),
  createPendingRelease: vi.fn(),
  updatePendingRelease: vi.fn(),
  releasePendingRelease: vi.fn(),
  cancelPendingRelease: vi.fn(),
}));
vi.mock("../api/pendingReleases", () => api);
const products = vi.hoisted(() => ({ listProducts: vi.fn() }));
vi.mock("../api/products", () => products);
const auth = vi.hoisted(() => ({ role: "OFFLINE_ENCODER" as string }));
vi.mock("../context/AuthContext", () => ({ useAuth: () => ({ user: { id: 1, role: auth.role } }) }));
vi.mock("../context/RealtimeContext", () => ({ useRealtimeVersion: () => 0 }));
vi.mock("../components/PageHeader", () => ({ PageHeader: ({ children }: { children?: ReactNode }) => <div>{children}</div> }));

let id = 0;
const item = (over: Record<string, unknown> = {}) => ({
  id: ++id,
  location: "OFFLINE",
  productId: 11,
  product: { id: 11, name: "SPECIAL", sku: "AFP007", unit: "bottle", category: "PREMIUM" },
  quantity: "24.00",
  madeDate: "2026-10-14T00:00:00.000Z",
  madeShift: "NIGHT",
  reason: "No sticker yet",
  status: "AWAITING",
  createdBy: { id: 3, name: "Ana Cruz" },
  createdAt: "2026-10-14T20:00:00.000Z",
  releasedAt: null,
  releasedBy: null,
  releasedEntryDate: null,
  releasedShift: null,
  resolutionNote: null,
  ageDays: 3,
  ...over,
});

beforeEach(() => {
  vi.clearAllMocks();
  id = 0;
  auth.role = "OFFLINE_ENCODER";
  api.listPendingReleases.mockResolvedValue({ items: [item()], total: 1 });
  products.listProducts.mockResolvedValue([{ id: 11, name: "SPECIAL", sku: "AFP007" }]);
});

describe("AwaitingReleasePage", () => {
  it("lists what is waiting, with its age, and starts on the encoder's own page", async () => {
    render(<AwaitingReleasePage />);
    expect(await screen.findByText("SPECIAL (AFP007)")).toBeTruthy();
    expect(screen.getByText(/waiting 3 days/)).toBeTruthy();
    expect(screen.getByText(/No sticker yet/)).toBeTruthy();
    expect(api.listPendingReleases).toHaveBeenCalledWith({ status: "AWAITING", location: "OFFLINE" }, 0, 20);
    expect(screen.queryByRole("combobox", { name: "Page" })).toBeNull(); // an encoder has no page choice
  });

  it("releases an item into the current shift and says where it went", async () => {
    api.releasePendingRelease.mockResolvedValue({});
    render(<AwaitingReleasePage />);
    fireEvent.click(await screen.findByRole("button", { name: /Release…/ }));
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByText(/never changed/)).toBeTruthy();
    fireEvent.click(within(dialog).getByRole("button", { name: "Release" }));
    await waitFor(() =>
      expect(api.releasePendingRelease).toHaveBeenCalledWith(1, expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/), expect.stringMatching(/MORNING|NIGHT/), undefined),
    );
    expect(await screen.findByText(/Released 24 bottle of SPECIAL into Offline Production/)).toBeTruthy();
  });

  it("keeps the dialog open with the server's reason when a release is refused", async () => {
    api.releasePendingRelease.mockRejectedValue(new Error("Offline entries for 2026-10-17 (Night shift) are finished and locked."));
    render(<AwaitingReleasePage />);
    fireEvent.click(await screen.findByRole("button", { name: /Release…/ }));
    fireEvent.click(within(await screen.findByRole("dialog")).getByRole("button", { name: "Release" }));
    expect(await screen.findByRole("alert")).toBeTruthy();
    expect(screen.getByText(/finished and locked/)).toBeTruthy();
    expect(screen.getByRole("dialog")).toBeTruthy();
  });

  it("only offers write-off to an admin", async () => {
    render(<AwaitingReleasePage />);
    await screen.findByText("SPECIAL (AFP007)");
    expect(screen.queryByRole("button", { name: /Write off/ })).toBeNull();
  });

  it("lets an admin write off, but only with a reason", async () => {
    auth.role = "SUPERVISOR_ADMIN";
    api.cancelPendingRelease.mockResolvedValue({});
    render(<AwaitingReleasePage />);
    fireEvent.click(await screen.findByRole("button", { name: /Write off…/ }));
    const dialog = await screen.findByRole("dialog");
    const confirm = within(dialog).getByRole("button", { name: "Write off" }) as HTMLButtonElement;
    expect(confirm.disabled).toBe(true);
    fireEvent.change(within(dialog).getByLabelText("Reason for writing off"), { target: { value: "Spoiled in storage" } });
    expect(confirm.disabled).toBe(false);
    fireEvent.click(confirm);
    await waitFor(() => expect(api.cancelPendingRelease).toHaveBeenCalledWith(1, "Spoiled in storage"));
  });

  it("does not offer actions on another page's items", async () => {
    api.listPendingReleases.mockResolvedValue({ items: [item({ location: "ONLINE" })], total: 1 });
    render(<AwaitingReleasePage />);
    await screen.findByText("SPECIAL (AFP007)");
    expect(screen.queryByRole("button", { name: /Release…/ })).toBeNull();
  });

  it("adds an item for the product, quantity and reason given", async () => {
    api.createPendingRelease.mockResolvedValue({});
    render(<AwaitingReleasePage />);
    fireEvent.click(await screen.findByRole("button", { name: "Add item" }));
    const dialog = await screen.findByRole("dialog");
    const add = within(dialog).getByRole("button", { name: "Add" }) as HTMLButtonElement;
    expect(add.disabled).toBe(true);

    await waitFor(() => expect(within(dialog).getByRole("option", { name: /SPECIAL/ })).toBeTruthy());
    fireEvent.change(within(dialog).getAllByRole("combobox")[0], { target: { value: "11" } });
    fireEvent.change(within(dialog).getByLabelText("Quantity"), { target: { value: "12" } });
    expect(add.disabled).toBe(false);
    fireEvent.click(add);

    await waitFor(() =>
      expect(api.createPendingRelease).toHaveBeenCalledWith(expect.objectContaining({ location: "OFFLINE", productId: 11, quantity: 12, reason: "No label yet" })),
    );
  });

  it("shows how a released item ended up", async () => {
    api.listPendingReleases.mockResolvedValue({
      items: [item({ status: "RELEASED", releasedEntryDate: "2026-10-17T00:00:00.000Z", releasedShift: "MORNING", releasedBy: { id: 3, name: "Ana Cruz" } })],
      total: 1,
    });
    render(<AwaitingReleasePage />);
    expect(await screen.findByText(/Released into .* by Ana Cruz/)).toBeTruthy();
    expect(screen.queryByRole("button", { name: /Release…/ })).toBeNull();
  });
});
