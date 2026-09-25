import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { TopProgressProvider } from "../hooks/useTopProgress";
import { ThemeProvider } from "../context/ThemeContext";
import { NavDrawerProvider } from "../context/NavDrawerContext";

// jsdom has no ResizeObserver - Toolbar and RowGlowScroll (used by StockGrid)
// both use one purely for layout measurement, which is meaningless in a
// jsdom test environment anyway.
class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}
vi.stubGlobal("ResizeObserver", ResizeObserverStub);

vi.mock("../api/onlineStock", () => ({
  getOnlineGrid: vi.fn(),
  saveOnlineEntry: vi.fn(),
}));
vi.mock("../api/offlineStock", () => ({
  getOfflineGrid: vi.fn(),
}));
vi.mock("../context/AuthContext", () => ({
  useAuth: () => ({ user: { id: 1, username: "admin", name: "Admin", role: "SUPERVISOR_ADMIN" } }),
}));

import { getOfflineGrid } from "../api/offlineStock";
import { getOnlineGrid, saveOnlineEntry } from "../api/onlineStock";
import { OnlineEntryPage } from "./OnlineEntryPage";

const product = { id: 1, sku: "AFP001", name: "Sweet A", category: "Class A (Liter)", unit: "Liter", isActive: true, sortOrder: 0 };
const onlineEntry = {
  productId: 1,
  entryDate: "2026-06-15",
  shift: "NIGHT",
  openingStock: 100,
  stockInOffToOl: 0,
  stockOutOlToOff: 0,
  onlineStock: 100,
  productionIn: 10,
  fulfillmentOut: 5,
  rts: 0,
  remainingStock: 105,
};
const gridRow = { product, entry: onlineEntry, isSaved: true };

function renderPage() {
  return render(
    <ThemeProvider>
      <NavDrawerProvider>
        <TopProgressProvider>
          <OnlineEntryPage />
        </TopProgressProvider>
      </NavDrawerProvider>
    </ThemeProvider>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  sessionStorage.clear();
  vi.mocked(getOfflineGrid).mockResolvedValue([]);
});

describe("OnlineEntryPage - loading", () => {
  it("shows a loading skeleton until the grid data arrives", async () => {
    vi.mocked(getOnlineGrid).mockReturnValue(new Promise(() => {})); // never resolves during this test

    renderPage();

    expect(screen.getByText("Loading online entries…")).toBeInTheDocument();
  });
});

describe("OnlineEntryPage - Save", () => {
  it("stays disabled until a change is staged (nothing to save yet)", async () => {
    vi.mocked(getOnlineGrid).mockResolvedValue([gridRow] as never);

    renderPage();

    await waitFor(() => expect(screen.queryByText("Loading online entries…")).not.toBeInTheDocument());
    expect(screen.getByRole("button", { name: "Save" })).toBeDisabled();
  });

  it("commits a cell edit and saves it through the API, clearing the pending count", async () => {
    vi.mocked(getOnlineGrid).mockResolvedValue([gridRow] as never);
    vi.mocked(saveOnlineEntry).mockResolvedValue({ ...onlineEntry, productionIn: 25 } as never);

    renderPage();
    await waitFor(() => expect(screen.queryByText("Loading online entries…")).not.toBeInTheDocument());

    const input = document.querySelector('[data-cell="1:productionIn"]') as HTMLInputElement;
    fireEvent.change(input, { target: { value: "25" } });
    fireEvent.blur(input);

    const toolbarSave = await screen.findByRole("button", { name: "Save (1)" });
    expect(toolbarSave).toBeEnabled();
    fireEvent.click(toolbarSave);

    const dialog = await screen.findByRole("dialog", { name: "Unsaved changes" });
    fireEvent.click(within(dialog).getByRole("button", { name: "Save (1)" }));

    await waitFor(() =>
      expect(saveOnlineEntry).toHaveBeenCalledWith(1, expect.any(String), expect.any(String), { productionIn: 25 }),
    );
    await waitFor(() => expect(screen.getByRole("button", { name: "Save" })).toBeDisabled());
  });
});
