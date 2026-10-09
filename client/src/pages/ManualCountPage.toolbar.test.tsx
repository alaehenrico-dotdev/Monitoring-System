import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ReactNode } from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { ManualCountPage } from "./ManualCountPage";

const api = vi.hoisted(() => ({ getManualCountGrid: vi.fn(), saveManualCount: vi.fn(), getVarianceTrace: vi.fn(), setCountRemarks: vi.fn(), publishManualCounts: vi.fn() }));
const auth = vi.hoisted(() => ({ role: "SUPERVISOR_ADMIN" }));
vi.mock("../context/AuthContext", () => ({ useAuth: () => ({ user: { id: 1, name: "Sup", username: "sup", role: auth.role } }) }));
vi.mock("../api/manualCounts", () => api);
vi.mock("../api/reportHistory", () => ({ recordReportHistory: vi.fn().mockResolvedValue({}) }));
vi.mock("../components/PageHeader", () => ({
  PageHeader: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));
// CSV tools (import modal, history) are not what these tests are about.
vi.mock("../components/CsvTools", () => ({ CsvTools: () => null }));
vi.mock("../hooks/useTopProgress", () => ({ useTopProgress: () => ({ start: vi.fn(), done: vi.fn() }) }));
vi.mock("../context/RealtimeContext", () => ({ useRealtimeVersion: () => 0 }));

const product = (id: number, name: string, category: string) => ({
  id,
  sku: `SKU${id}`,
  name,
  category,
  unit: "pc",
  isActive: true,
  sortOrder: id,
});
const row = (id: number, name: string, category: string, loc: "ONLINE" | "OFFLINE", system: number, count: number | null) => ({
  product: product(id, name, category),
  entry: {
    productId: id,
    entryDate: "2026-10-09",
    shift: "NIGHT",
    location: loc,
    systemRemainingStock: system,
    manualCount: count,
    variance: count === null ? null : system - count,
  },
  isSaved: count !== null,
  isFlagged: count !== null && system !== count,
});

beforeEach(() => {
  vi.clearAllMocks();
  auth.role = "SUPERVISOR_ADMIN";
  sessionStorage.clear();
  Element.prototype.scrollIntoView = vi.fn();
  api.getManualCountGrid.mockImplementation((_d: string, _s: string, loc: "ONLINE" | "OFFLINE") =>
    Promise.resolve([
      row(1, "Soy Sauce", "Sauces", loc, 10, loc === "ONLINE" ? 8 : null),
      row(2, "Vinegar", "Sauces", loc, 5, loc === "ONLINE" ? 5 : null),
      row(3, "Rice", "Grains", loc, 0, loc === "ONLINE" ? 0 : null),
    ]),
  );
});

async function open() {
  render(
    <MemoryRouter>
      <ManualCountPage />
    </MemoryRouter>,
  );
  // Categories start collapsed; the headings are the first thing to appear.
  await screen.findByText("Sauces");
}

describe("ManualCountPage - toolbar from the entry pages", () => {
  it("Zero all stages a 0 for the whole category and shows the unsaved badge", async () => {
    await open();

    fireEvent.click(screen.getAllByText("Zero all")[0]);

    // Sauces = 2 products x 2 locations, each a change from its saved count (or from none).
    // (The toolbar renders hidden measuring copies, so there is more than one badge.)
    expect((await screen.findAllByText(/4/, { selector: ".ae-unsaved-badge" })).length).toBeGreaterThan(0);
    expect(api.saveManualCount).not.toHaveBeenCalled();
  });

  it("Clear discards staged counts after a confirm", async () => {
    await open();
    fireEvent.click(screen.getAllByText("Zero all")[0]);
    await screen.findAllByText(/unsaved change/);

    fireEvent.click(screen.getAllByRole("button", { name: /Clear/ })[0]);
    fireEvent.click(await screen.findByRole("button", { name: "Discard" }));

    await waitFor(() => expect(screen.queryAllByText(/unsaved change/)).toHaveLength(0));
  });

  it("expands every category from one button", async () => {
    await open();
    // Collapsed rows stay in the DOM, hidden by this class.
    const collapsed = (name: string) => screen.getByText(name).closest("tr")!.classList.contains("ae-row-collapsed");
    expect(collapsed("Soy Sauce")).toBe(true);

    fireEvent.click(screen.getAllByRole("button", { name: "Expand every category" })[0]);

    await waitFor(() => expect(collapsed("Soy Sauce")).toBe(false));
    expect(collapsed("Rice")).toBe(false);
  });

  it("filters to flagged rows only", async () => {
    await open();
    fireEvent.click(screen.getAllByRole("button", { name: "Expand every category" })[0]);
    await screen.findByText("Rice");

    fireEvent.click(screen.getAllByRole("button", { name: /Filter rows/i })[0]);
    fireEvent.click(await screen.findByRole("option", { name: /Flagged only/ }));

    await waitFor(() => expect(screen.queryByText("Rice")).toBeNull());
    expect(screen.getByText("Soy Sauce")).toBeTruthy();
    expect(screen.queryByText("Vinegar")).toBeNull();
  });
});

describe("ManualCountPage - clearing a saved 0", () => {
  it("is not a change: Save stays quiet and the 0 comes back", async () => {
    await open();
    fireEvent.click(screen.getAllByRole("button", { name: "Expand every category" })[0]);
    const cell = (await waitFor(() => {
      const el = document.querySelector<HTMLInputElement>('input[data-cell="manual-count-ONLINE-3"]');
      if (!el) throw new Error("not rendered");
      return el;
    })) as HTMLInputElement;
    expect(cell.value).toBe("0");

    fireEvent.change(cell, { target: { value: "" } });
    fireEvent.blur(cell);

    await waitFor(() => expect(cell.value).toBe("0"));
    expect(screen.queryAllByText(/unsaved change/)).toHaveLength(0);
  });
});

describe("ManualCountPage - variance details", () => {
  it("opens the details for a product that has a saved count", async () => {
    api.getVarianceTrace.mockResolvedValue({
      product: { id: 1, sku: "SKU1", name: "Soy Sauce" },
      location: "ONLINE",
      entryDate: "2026-10-09",
      shift: "NIGHT",
      count: { manualCount: 8, systemRemainingStock: 10, variance: 2, remarks: null, countedBy: "Ana", countedAt: null, publishedAt: null },
      opening: { expected: 10, actual: 10, isBreak: false, source: "system" },
      entrySaved: true,
      encodedBy: null,
      figures: [],
      history: [],
    });
    await open();
    fireEvent.click(screen.getAllByRole("button", { name: "Expand every category" })[0]);

    fireEvent.click(await screen.findByRole("button", { name: "Variance details for Soy Sauce" }));

    expect(await screen.findByRole("dialog", { name: /Variance details/ })).toBeTruthy();
    await waitFor(() => expect(api.getVarianceTrace).toHaveBeenCalledWith(1, expect.any(String), expect.any(String), "ONLINE"));
  });

  it("shows no details button where the count matches the system", async () => {
    await open();
    fireEvent.click(screen.getAllByRole("button", { name: "Expand every category" })[0]);
    await screen.findByRole("button", { name: "Variance details for Soy Sauce" });

    // Vinegar (5 vs 5) and Rice (0 vs 0) are counted and correct.
    expect(screen.queryByRole("button", { name: "Variance details for Vinegar" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Variance details for Rice" })).toBeNull();
  });

  it("gives the button its own Remarks column", async () => {
    await open();
    fireEvent.click(screen.getAllByRole("button", { name: "Expand every category" })[0]);
    const button = await screen.findByRole("button", { name: "Variance details for Soy Sauce" });

    const cell = button.closest("td")!;
    expect(cell.classList.contains("ae-remarks-cell")).toBe(true);
    const headers = [...cell.closest("table")!.querySelectorAll("th")].map((th) => th.textContent);
    expect(headers[headers.length - 1]).toBe("Remarks");
    expect(cell.closest("tr")!.lastElementChild).toBe(cell);
  });

  it("shows a recorded reason in that column", async () => {
    api.getManualCountGrid.mockImplementation((_d: string, _s: string, loc: "ONLINE" | "OFFLINE") => {
      const r = row(1, "Soy Sauce", "Sauces", loc, 10, loc === "ONLINE" ? 8 : null);
      return Promise.resolve([loc === "ONLINE" ? { ...r, entry: { ...r.entry, remarks: "Spoilage" } } : r]);
    });
    await open();
    fireEvent.click(screen.getAllByRole("button", { name: "Expand every category" })[0]);
    expect(await screen.findByText("Spoilage")).toBeTruthy();
  });
});

describe("ManualCountPage - undo of staged edits", () => {
  const badges = () => screen.queryAllByText(/unsaved change/);
  const undo = () => fireEvent.click(screen.getAllByRole("button", { name: /Undo/ })[0]);

  async function expandAndGet(loc: "ONLINE" | "OFFLINE", id: number) {
    fireEvent.click(screen.getAllByRole("button", { name: "Expand every category" })[0]);
    return (await waitFor(() => {
      const el = document.querySelector<HTMLInputElement>(`input[data-cell="manual-count-${loc}-${id}"]`);
      if (!el) throw new Error("not rendered");
      return el;
    })) as HTMLInputElement;
  }

  it("has no Undo until something has been staged", async () => {
    await open();
    expect(screen.queryAllByRole("button", { name: /Undo/ })).toHaveLength(0);
  });

  it("undoes Zero all in one step", async () => {
    await open();
    fireEvent.click(screen.getAllByText("Zero all")[0]);
    await screen.findAllByText(/unsaved change/);

    undo();

    await waitFor(() => expect(badges()).toHaveLength(0));
  });

  it("undoes one cell edit - however many keystrokes it took - and redo brings it back", async () => {
    await open();
    const cell = await expandAndGet("OFFLINE", 1);
    fireEvent.focus(cell);
    fireEvent.change(cell, { target: { value: "1" } });
    fireEvent.change(cell, { target: { value: "12" } });
    fireEvent.blur(cell);
    await screen.findAllByText(/unsaved change/);
    expect(cell.value).toBe("12");

    undo();
    await waitFor(() => expect(cell.value).toBe(""));
    expect(badges()).toHaveLength(0);

    fireEvent.keyDown(window, { key: "z", ctrlKey: true, shiftKey: true });
    await waitFor(() => expect(cell.value).toBe("12"));
  });

  it("steps back one edit at a time, newest first", async () => {
    await open();
    const a = await expandAndGet("OFFLINE", 1);
    const b = document.querySelector<HTMLInputElement>('input[data-cell="manual-count-OFFLINE-2"]')!;
    fireEvent.focus(a);
    fireEvent.change(a, { target: { value: "3" } });
    fireEvent.blur(a);
    fireEvent.focus(b);
    fireEvent.change(b, { target: { value: "4" } });
    fireEvent.blur(b);
    await waitFor(() => expect(b.value).toBe("4"));

    undo();
    await waitFor(() => expect(b.value).toBe(""));
    expect(a.value).toBe("3");

    undo();
    await waitFor(() => expect(a.value).toBe(""));
  });

  it("works from the keyboard when not typing in a cell", async () => {
    await open();
    fireEvent.click(screen.getAllByText("Zero all")[0]);
    await screen.findAllByText(/unsaved change/);

    fireEvent.keyDown(window, { key: "z", ctrlKey: true });

    await waitFor(() => expect(badges()).toHaveLength(0));
  });
});

describe("ManualCountPage - publishing the sheet", () => {
  const publishBtn = () => screen.queryAllByRole("button", { name: /Publish/ }).find((b) => !b.hasAttribute("aria-hidden"));

  it("shows how many saved counts are still unpublished", async () => {
    await open();
    expect((await screen.findAllByText("3 unpublished")).length).toBeGreaterThan(0);
  });

  it("publishes the sheet after a confirm, then reports it", async () => {
    api.publishManualCounts.mockResolvedValue({ published: 3, publishedAt: "2026-10-09T22:00:00.000Z" });
    await open();
    await screen.findAllByText("3 unpublished");

    fireEvent.click(screen.getAllByRole("button", { name: /Publish/ })[0]);
    fireEvent.click(await screen.findByRole("button", { name: "Publish 3" }));

    await waitFor(() => expect(api.publishManualCounts).toHaveBeenCalledWith(expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/), expect.any(String)));
    expect(await screen.findByText(/Published 3 counts - they are now the next shift's opening stock/)).toBeTruthy();
  });

  it("says Published once every saved count is, and has nothing left to publish", async () => {
    api.getManualCountGrid.mockImplementation((_d: string, _s: string, loc: "ONLINE" | "OFFLINE") =>
      Promise.resolve(
        [row(1, "Soy Sauce", "Sauces", loc, 10, loc === "ONLINE" ? 8 : null)].map((r) => ({ ...r, entry: { ...r.entry, publishedAt: "2026-10-09T20:00:00.000Z" } })),
      ),
    );
    await open();
    expect((await screen.findAllByText("Published")).length).toBeGreaterThan(0);
    expect((screen.getAllByRole("button", { name: /Publish/ })[0] as HTMLButtonElement).disabled).toBe(true);
  });

  it("will not publish while counts are staged but unsaved", async () => {
    await open();
    fireEvent.click(screen.getAllByText("Zero all")[0]);
    await screen.findAllByText(/unsaved change/);
    expect((screen.getAllByRole("button", { name: /Publish/ })[0] as HTMLButtonElement).disabled).toBe(true);
  });

  it("is a supervisor's step: encoders do not get the button", async () => {
    auth.role = "ONLINE_ENCODER";
    await open();
    await screen.findAllByText("3 unpublished");
    expect(publishBtn()).toBeUndefined();
  });
});

