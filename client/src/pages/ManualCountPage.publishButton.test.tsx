import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ReactNode } from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { ManualCountPage } from "./ManualCountPage";
import { chooseFromMenu } from "./menuTestHelpers";

const api = vi.hoisted(() => ({ getManualCountGrid: vi.fn(), saveManualCount: vi.fn(), getVarianceTrace: vi.fn(), setCountRemarks: vi.fn(), publishManualCounts: vi.fn() }));
vi.mock("../context/AuthContext", () => ({ useAuth: () => ({ user: { id: 1, name: "Sup", username: "sup", role: "SUPERVISOR_ADMIN" } }) }));
vi.mock("../api/manualCounts", () => api);
vi.mock("../api/reportHistory", () => ({ recordReportHistory: vi.fn().mockResolvedValue({}) }));
vi.mock("../components/PageHeader", () => ({
  PageHeader: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));
vi.mock("../components/CsvTools", () => ({ CsvTools: () => null }));
vi.mock("../hooks/useTopProgress", () => ({ useTopProgress: () => ({ start: vi.fn(), done: vi.fn() }) }));
vi.mock("../context/RealtimeContext", () => ({ useRealtimeVersion: () => 0 }));

const product = { id: 1, sku: "SKU1", name: "Soy Sauce", category: "Sauces", unit: "pc", isActive: true, sortOrder: 1 };
function grid(publishedAt: string | null) {
  api.getManualCountGrid.mockImplementation((_d: string, _s: string, loc: "ONLINE" | "OFFLINE") =>
    Promise.resolve([
      {
        product,
        entry: { productId: 1, entryDate: "2026-10-09", shift: "NIGHT", location: loc, systemRemainingStock: 10, manualCount: loc === "ONLINE" ? 8 : null, variance: loc === "ONLINE" ? 2 : null, publishedAt: loc === "ONLINE" ? publishedAt : null, isOpeningBalance: false },
        isSaved: loc === "ONLINE",
        isFlagged: loc === "ONLINE",
      },
    ]),
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  sessionStorage.clear();
  Element.prototype.scrollIntoView = vi.fn();
});

async function open() {
  render(
    <MemoryRouter>
      <ManualCountPage />
    </MemoryRouter>,
  );
  await screen.findByText("Sauces");
}
/// The toolbar renders hidden measuring copies too, so take the first real one.
const publishButton = () => screen.getAllByRole("button", { name: /^Publish$/ })[0];

describe("ManualCountPage - Publish button", () => {
  it("sits in the bar's action group, beside Save, with a Publish label", async () => {
    grid(null);
    await open();
    const btn = publishButton();
    expect(btn.textContent).toContain("Publish");
    // In the right-hand action group, after Save (the consequential action sits
    // apart from the filters).
    expect(btn.closest(".ae-mb-actions")).not.toBeNull();
    expect(screen.getAllByRole("button", { name: /^Save/ })[0].compareDocumentPosition(btn) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("glows (ready) once the counts are saved and nothing is staged", async () => {
    grid(null);
    await open();
    expect(publishButton().closest(".ae-split")!.classList.contains("ae-split--attention")).toBe(true);
    expect(publishButton().getAttribute("aria-disabled")).toBeNull();
  });

  it("does not glow when everything saved is already published", async () => {
    grid("2026-10-09T10:00:00.000Z");
    await open();
    expect(publishButton().closest(".ae-split")!.classList.contains("ae-split--attention")).toBe(false);
    expect(publishButton().getAttribute("aria-disabled")).toBe("true");
  });

  it("stops glowing while counts are still being added or edited", async () => {
    grid(null);
    await open();
    chooseFromMenu("View", /Expand all categories/);
    fireEvent.click(screen.getAllByText("Clear all")[0]);
    await screen.findAllByText(/unsaved change/);
    expect(publishButton().closest(".ae-split")!.classList.contains("ae-split--attention")).toBe(false);
    expect(publishButton().getAttribute("aria-disabled")).toBe("true");
  });
});
