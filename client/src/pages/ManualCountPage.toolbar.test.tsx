import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ReactNode } from "react";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { ManualCountPage } from "./ManualCountPage";
import { chooseFromMenu, menuItem } from "./menuTestHelpers";

const api = vi.hoisted(() => ({ getManualCountGrid: vi.fn(), saveManualCount: vi.fn(), getVarianceTrace: vi.fn(), setCountRemarks: vi.fn(), publishManualCounts: vi.fn(), getAuditSnapshot: vi.fn() }));
const pdf = vi.hoisted(() => ({ downloadTablePdf: vi.fn() }));
const auth = vi.hoisted(() => ({ role: "SUPERVISOR_ADMIN" }));
vi.mock("../context/AuthContext", () => ({ useAuth: () => ({ user: { id: 1, name: "Sup", username: "sup", role: auth.role } }) }));
vi.mock("../api/manualCounts", () => api);
const subs = vi.hoisted(() => ({ listSubmissions: vi.fn(), reopenSubmissions: vi.fn() }));
vi.mock("../api/countSubmissions", () => subs);
vi.mock("../api/reportHistory", () => ({ recordReportHistory: vi.fn().mockResolvedValue({}) }));
vi.mock("../components/PageHeader", () => ({
  PageHeader: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));
// CSV tools (import modal, history) are not what these tests are about.
vi.mock("../components/CsvTools", () => ({ CsvTools: () => null }));
vi.mock("../hooks/useTopProgress", () => ({ useTopProgress: () => ({ start: vi.fn(), done: vi.fn(), track: (fn: () => unknown) => fn() }) }));
vi.mock("../utils/tablePdf", () => pdf);
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
    variance: count === null ? null : count - system,
  },
  isSaved: count !== null,
  isFlagged: count !== null && system !== count,
});

beforeEach(() => {
  vi.clearAllMocks();
  auth.role = "SUPERVISOR_ADMIN";
  sessionStorage.clear();
  Element.prototype.scrollIntoView = vi.fn();
  subs.listSubmissions.mockResolvedValue([]);
  subs.reopenSubmissions.mockResolvedValue({ reopened: 1 });
  api.getManualCountGrid.mockImplementation((_d: string, _s: string, loc: "ONLINE" | "OFFLINE") =>
    Promise.resolve([
      row(1, "Soy Sauce", "Sauces", loc, 10, loc === "ONLINE" ? 8 : null),
      row(2, "Vinegar", "Sauces", loc, 5, loc === "ONLINE" ? 5 : null),
      row(3, "Rice", "Grains", loc, 0, loc === "ONLINE" ? 0 : null),
    ]),
  );
});

async function open(url = "/") {
  render(
    <MemoryRouter initialEntries={[url]}>
      <ManualCountPage />
    </MemoryRouter>,
  );
  // Categories start collapsed; the headings are the first thing to appear.
  await screen.findByText("Sauces");
}

describe("ManualCountPage - toolbar from the entry pages", () => {
  it("Clear all removes the saved counts of the whole category (uncounted cells are not changes) and shows the unsaved badge", async () => {
    await open();

    fireEvent.click(screen.getAllByText("Clear all")[0]);

    // Sauces = 2 products x 2 locations, but only the 2 Online counts were ever saved; the
    // Offline cells were never counted, so clearing them changes nothing.
    // (The toolbar renders hidden measuring copies, so there is more than one badge.)
    expect((await screen.findAllByText(/2/, { selector: ".ae-unsaved-badge" })).length).toBeGreaterThan(0);
    expect(api.saveManualCount).not.toHaveBeenCalled();
  });

  it("Clear discards staged counts after a confirm", async () => {
    await open();
    fireEvent.click(screen.getAllByText("Clear all")[0]);
    await screen.findAllByText(/unsaved change/);

    chooseFromMenu("Edit", /Clear unsaved counts/);
    fireEvent.click(await screen.findByRole("button", { name: "Discard" }));

    await waitFor(() => expect(screen.queryAllByText(/unsaved change/)).toHaveLength(0));
  });

  it("keeps Reorder products in the Edit menu, for an admin only, and not in View", async () => {
    await open();
    expect(menuItem("Edit", /Reorder products/).getAttribute("aria-disabled")).not.toBe("true");
    fireEvent.click(screen.getAllByRole("menuitem", { name: /^View/ })[0]);
    expect(screen.queryByRole("menuitem", { name: /Reorder products/ })).toBeNull();
  });

  it("makes Reorder unavailable to an encoder, and says why", async () => {
    auth.role = "ENCODER";
    await open();
    const item = menuItem("Edit", /Reorder products/);
    expect(item.getAttribute("aria-disabled")).toBe("true");
    expect(item.getAttribute("title")).toBe("Only an admin can change the product order");
  });

  it("expands every category from one button", async () => {
    await open();
    // Collapsed rows stay in the DOM, hidden by this class.
    const collapsed = (name: string) => screen.getByText(name).closest("tr")!.classList.contains("ae-row-collapsed");
    expect(collapsed("Soy Sauce")).toBe(true);

    chooseFromMenu("View", /Expand all categories/);

    await waitFor(() => expect(collapsed("Soy Sauce")).toBe(false));
    expect(collapsed("Rice")).toBe(false);
  });

  it("filters to flagged rows only", async () => {
    await open();
    chooseFromMenu("View", /Expand all categories/);
    await screen.findByText("Rice");

    fireEvent.click(screen.getAllByRole("button", { name: /Filter rows/i })[0]);
    fireEvent.click(await screen.findByRole("option", { name: /Flagged only/ }));

    await waitFor(() => expect(screen.queryByText("Rice")).toBeNull());
    expect(screen.getByText("Soy Sauce")).toBeTruthy();
    expect(screen.queryByText("Vinegar")).toBeNull();
  });
});

describe("ManualCountPage - a category with staged counts", () => {
  const bar = (name: RegExp) => screen.getByRole("button", { name });
  const hidden = (product: string) => screen.getByText(product).closest("tr")!.classList.contains("ae-row-collapsed");

  it("opens by itself, turns its bar blue, and can still be collapsed (staying blue)", async () => {
    await open();
    expect(bar(/^Sauces/).classList.contains("ae-cat-toggle--edited")).toBe(false);

    fireEvent.click(screen.getAllByText("Clear all")[0]); // stages counts in Sauces
    await waitFor(() => expect(bar(/^Sauces/).classList.contains("ae-cat-toggle--edited")).toBe(true));
    expect(hidden("Soy Sauce")).toBe(false);
    expect(bar(/^Sauces/).getAttribute("aria-disabled")).toBeNull();
    // Only the edited category changes colour.
    expect(bar(/^Grains/).classList.contains("ae-cat-toggle--edited")).toBe(false);

    fireEvent.click(bar(/^Sauces/));
    await waitFor(() => expect(hidden("Soy Sauce")).toBe(true));
    expect(bar(/^Sauces/).getAttribute("aria-expanded")).toBe("false");
    expect(bar(/^Sauces/).classList.contains("ae-cat-toggle--edited")).toBe(true);

    fireEvent.click(bar(/^Sauces/));
    await waitFor(() => expect(hidden("Soy Sauce")).toBe(false));
  });
});

type SubLine = { productId: number; location: "ONLINE" | "OFFLINE"; qty: number | null; note: string | null };
const submission = (id: number, name: string, status: "DRAFT" | "SUBMITTED", lines: SubLine[]) => ({
  id,
  auditor: { id: id + 10, name },
  status,
  submittedAt: status === "SUBMITTED" ? "2026-10-09T14:00:00.000Z" : null,
  reopenedAt: null,
  reopenReason: null,
  updatedAt: "2026-10-09T14:00:00.000Z",
  counted: {
    ONLINE: lines.filter((l) => l.location === "ONLINE" && l.qty !== null).length,
    OFFLINE: lines.filter((l) => l.location === "OFFLINE" && l.qty !== null).length,
  },
  lines,
});
const L = (productId: number, location: "ONLINE" | "OFFLINE", qty: number | null, note: string | null = null): SubLine => ({ productId, location, qty, note });
// Saved Online counts are Soy Sauce 8, Vinegar 5, Rice 0; Offline is uncounted.
const ANA = () => submission(1, "Ana Cruz", "SUBMITTED", [L(1, "ONLINE", 9, "shelf B"), L(2, "ONLINE", 5), L(3, "OFFLINE", 4)]);
const BEN = () => submission(2, "Ben Lim", "SUBMITTED", [L(1, "ONLINE", 9), L(3, "OFFLINE", 6)]);
const cell = (loc: "ONLINE" | "OFFLINE", id: number) => document.querySelector<HTMLInputElement>(`input[data-cell="manual-count-${loc}-${id}"]`)!;

describe("ManualCountPage - auditor counts", () => {
  it("opens the sheet a queue/alert link names (review=1), without printing or resuming another sheet", async () => {
    await open("/?review=1&date=2026-10-08&shift=MORNING");
    await waitFor(() => expect(api.getManualCountGrid).toHaveBeenCalledWith("2026-10-08", "MORNING", "ONLINE"));
    expect(subs.listSubmissions).toHaveBeenCalledWith("2026-10-08", "MORNING");
  });

  it("shows nothing extra when no auditor has sent anything", async () => {
    await open();
    expect(screen.queryByRole("region", { name: "Auditor counts" })).toBeNull();
    expect(document.querySelector(".ae-aud-chips")).toBeNull();
  });

  it("lists who is counting and who submitted, with how much", async () => {
    subs.listSubmissions.mockResolvedValue([ANA(), submission(3, "Cy Tan", "DRAFT", [L(1, "ONLINE", 3)])]);
    await open();
    const panel = await screen.findByRole("region", { name: "Auditor counts" });
    expect(within(panel).getByText("Ana Cruz")).toBeTruthy();
    expect(within(panel).getByText(/^Submitted/)).toBeTruthy();
    expect(within(panel).getByText("Online 2 · Offline 1")).toBeTruthy();
    expect(within(panel).getByText("Counting…")).toBeTruthy();
  });

  it("shows no buttons on the rows; each submitted auditor is a button in the banner", async () => {
    subs.listSubmissions.mockResolvedValue([ANA(), BEN()]);
    await open();
    expect(await screen.findByRole("button", { name: "Use Ana Cruz's counts (2)" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Use Ben Lim's counts (2)" })).toBeTruthy();
    expect(document.querySelector(".ae-aud-chips")).toBeNull();
  });

  it("clicking an auditor fills the cells as ordinary unsaved counts - nothing is saved", async () => {
    subs.listSubmissions.mockResolvedValue([ANA(), BEN()]);
    await open();
    fireEvent.click(await screen.findByRole("button", { name: "Use Ana Cruz's counts (2)" }));
    await waitFor(() => expect(cell("ONLINE", 1).value).toBe("9"));
    expect(cell("OFFLINE", 3).value).toBe("4");
    expect((await screen.findAllByText(/unsaved change/)).length).toBeGreaterThan(0);
    expect(api.saveManualCount).not.toHaveBeenCalled();
    // Ana is now fully in the table; Ben still differs on Rice (6 vs 4), so he stays clickable.
    expect(screen.getByRole("button", { name: "Ana Cruz's counts are already in the table" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Use Ben Lim's counts (1)" })).toBeTruthy();
    // The category holding it turns blue.
    expect(screen.getByRole("button", { name: /^Sauces/ }).classList.contains("ae-cat-toggle--edited")).toBe(true);
  });

  it("a draft auditor is shown but cannot be used", async () => {
    subs.listSubmissions.mockResolvedValue([submission(3, "Cy Tan", "DRAFT", [L(1, "ONLINE", 3)])]);
    await open();
    const panel = await screen.findByRole("region", { name: "Auditor counts" });
    expect(within(panel).getByText("Cy Tan")).toBeTruthy();
    expect(within(panel).queryByRole("button", { name: /Use Cy Tan/ })).toBeNull();
  });

  it("can filter to the rows still to review", async () => {
    subs.listSubmissions.mockResolvedValue([ANA(), BEN()]);
    await open();
    await screen.findByRole("button", { name: /Use Ana Cruz/ });
    fireEvent.click(screen.getAllByRole("button", { name: /Filter rows/i })[0]);
    fireEvent.click(await screen.findByRole("option", { name: /Auditor: to review \(2\)/ }));
    // Soy Sauce (9 vs 8) and Rice (offline, undecided) stay; Vinegar already matches Ana's 5.
    await waitFor(() => expect(screen.queryByText("Vinegar")).toBeNull());
    expect(screen.getByText("Soy Sauce")).toBeTruthy();
    expect(screen.getByText("Rice")).toBeTruthy();
  });

  it("sends back only the auditors the admin picks, with a note", async () => {
    subs.listSubmissions.mockResolvedValue([ANA(), BEN()]);
    await open();
    fireEvent.click(await screen.findByRole("button", { name: "Reopen…" }));
    const dialog = await screen.findByRole("dialog");
    const ana = within(dialog).getByRole("checkbox", { name: /Ana Cruz/ }) as HTMLInputElement;
    const ben = within(dialog).getByRole("checkbox", { name: /Ben Lim/ }) as HTMLInputElement;
    expect(ana.checked && ben.checked).toBe(true);
    fireEvent.click(ben);
    fireEvent.change(within(dialog).getByPlaceholderText(/Recount aisle 3/), { target: { value: "recount cold room" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Reopen 1" }));
    await waitFor(() => expect(subs.reopenSubmissions).toHaveBeenCalledWith(expect.any(String), expect.any(String), [11], "recount cold room"));
    expect(await screen.findByText(/Sent 1 count back for a recount/)).toBeTruthy();
  });

  it("cannot reopen with nobody picked, or when nothing is submitted", async () => {
    subs.listSubmissions.mockResolvedValue([submission(3, "Cy Tan", "DRAFT", [L(1, "ONLINE", 3)])]);
    await open();
    expect(((await screen.findByRole("button", { name: "Reopen…" })) as HTMLButtonElement).disabled).toBe(true);
  });

  it("warns at publish when an auditor has counts typed but not submitted, and says go on", async () => {
    api.publishManualCounts.mockResolvedValue({ published: 3, publishedAt: "2026-10-09T22:00:00.000Z" });
    subs.listSubmissions.mockResolvedValue([ANA(), submission(3, "Cy Tan", "DRAFT", [L(1, "ONLINE", 3)])]);
    await open();
    await screen.findByRole("region", { name: "Auditor counts" });
    await screen.findAllByText("3 unpublished");
    fireEvent.click(screen.getAllByRole("button", { name: /Publish/ })[0]);
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByText(/Cy Tan has counts typed but not submitted/)).toBeTruthy();
    expect(within(dialog).getByText(/auditor counts you have not used/)).toBeTruthy();
    fireEvent.click(within(dialog).getByRole("button", { name: "Publish 3" }));
    await waitFor(() => expect(api.publishManualCounts).toHaveBeenCalledWith(expect.any(String), expect.any(String), true, true));
  });
});

describe("ManualCountPage - clearing a saved 0", () => {
  it("is not a change: Save stays quiet and the 0 comes back", async () => {
    await open();
    chooseFromMenu("View", /Expand all categories/);
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
      count: { manualCount: 8, systemRemainingStock: 10, variance: -2, remarks: null, countedBy: "Ana", countedAt: null, publishedAt: null },
      opening: { expected: 10, actual: 10, isBreak: false, source: "system" },
      entrySaved: true,
      encodedBy: null,
      figures: [],
      history: [],
    });
    await open();
    chooseFromMenu("View", /Expand all categories/);

    fireEvent.click(await screen.findByRole("button", { name: "Variance details for Soy Sauce" }));

    expect(await screen.findByRole("dialog", { name: /Variance details/ })).toBeTruthy();
    await waitFor(() => expect(api.getVarianceTrace).toHaveBeenCalledWith(1, expect.any(String), expect.any(String), "ONLINE"));
  });

  it("shows no details button where the count matches the system", async () => {
    await open();
    chooseFromMenu("View", /Expand all categories/);
    await screen.findByRole("button", { name: "Variance details for Soy Sauce" });

    // Vinegar (5 vs 5) and Rice (0 vs 0) are counted and correct.
    expect(screen.queryByRole("button", { name: "Variance details for Vinegar" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Variance details for Rice" })).toBeNull();
  });

  it("gives the button its own Remarks column", async () => {
    await open();
    chooseFromMenu("View", /Expand all categories/);
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
    chooseFromMenu("View", /Expand all categories/);
    expect(await screen.findByText("Spoilage")).toBeTruthy();
  });
});

describe("ManualCountPage - undo of staged edits", () => {
  const badges = () => screen.queryAllByText(/unsaved change/);
  const undo = () => chooseFromMenu("Edit", /^Undo/);

  async function expandAndGet(loc: "ONLINE" | "OFFLINE", id: number) {
    chooseFromMenu("View", /Expand all categories/);
    return (await waitFor(() => {
      const el = document.querySelector<HTMLInputElement>(`input[data-cell="manual-count-${loc}-${id}"]`);
      if (!el) throw new Error("not rendered");
      return el;
    })) as HTMLInputElement;
  }

  it("has no Undo until something has been staged", async () => {
    await open();
    expect(menuItem("Edit", /^Undo/).getAttribute("aria-disabled")).toBe("true");
  });

  it("undoes Clear all in one step", async () => {
    await open();
    fireEvent.click(screen.getAllByText("Clear all")[0]);
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
    fireEvent.click(screen.getAllByText("Clear all")[0]);
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

    await waitFor(() => expect(api.publishManualCounts).toHaveBeenCalledWith(expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/), expect.any(String), true, false));
    expect(await screen.findByText(/Published 3 counts - now the next day's opening stock/)).toBeTruthy();
  });

  it("can also use the counts as the next day's opening stock, and says how many later days could not be updated", async () => {
    api.publishManualCounts.mockResolvedValue({ published: 3, publishedAt: "2026-10-09T22:00:00.000Z", appliedToOpening: true, leftSaved: 2 });
    await open();
    await screen.findAllByText("3 unpublished");

    fireEvent.click(screen.getAllByRole("button", { name: /Publish/ })[0]);
    const toggle = (await screen.findByLabelText(/Also use these counts as the next day's opening stock/)) as HTMLInputElement;
    expect(toggle.checked).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "Publish 3" }));

    await waitFor(() => expect(api.publishManualCounts).toHaveBeenCalledWith(expect.any(String), expect.any(String), true, false));
    expect(await screen.findByText(/now the next day's opening stock · 2 products have a later day that could not be updated/)).toBeTruthy();
  });

  it("publishes as an audit only when the option is unticked", async () => {
    api.publishManualCounts.mockResolvedValue({ published: 3, publishedAt: "2026-10-09T22:00:00.000Z", appliedToOpening: false });
    await open();
    await screen.findAllByText("3 unpublished");

    fireEvent.click(screen.getAllByRole("button", { name: /Publish/ })[0]);
    fireEvent.click(await screen.findByLabelText(/Also use these counts as the next day's opening stock/));
    fireEvent.click(screen.getByRole("button", { name: "Publish 3" }));

    await waitFor(() => expect(api.publishManualCounts).toHaveBeenCalledWith(expect.any(String), expect.any(String), false, false));
    expect(await screen.findByText(/Published 3 counts - now final for reporting/)).toBeTruthy();
  });

  it("says Published once every saved count is, and has nothing left to publish", async () => {
    api.getManualCountGrid.mockImplementation((_d: string, _s: string, loc: "ONLINE" | "OFFLINE") =>
      Promise.resolve(
        [row(1, "Soy Sauce", "Sauces", loc, 10, loc === "ONLINE" ? 8 : null)].map((r) => ({ ...r, entry: { ...r.entry, publishedAt: "2026-10-09T20:00:00.000Z" } })),
      ),
    );
    await open();
    expect((await screen.findAllByText("Published")).length).toBeGreaterThan(0);
    expect(screen.getAllByRole("button", { name: /^Publish$/ })[0].getAttribute("aria-disabled")).toBe("true");
  });

  it("shows a published sheet's count cells blank, ready for the next audit", async () => {
    api.getManualCountGrid.mockImplementation((_d: string, _s: string, loc: "ONLINE" | "OFFLINE") =>
      Promise.resolve([row(1, "Soy Sauce", "Sauces", loc, 10, 8)].map((r) => ({ ...r, entry: { ...r.entry, publishedAt: "2026-10-09T20:00:00.000Z" } }))),
    );
    await open();
    await screen.findAllByText("Published");
    // Nothing on the sheet counts as a saved count any more, so there is nothing for Clear all to clear.
    fireEvent.click(screen.getAllByText("Clear all")[0]);
    expect(screen.queryAllByText(/unsaved change/)).toHaveLength(0);
  });

  it("will not publish while counts are staged but unsaved", async () => {
    await open();
    fireEvent.click(screen.getAllByText("Clear all")[0]);
    await screen.findAllByText(/unsaved change/);
    expect(screen.getAllByRole("button", { name: /^Publish$/ })[0].getAttribute("aria-disabled")).toBe("true");
  });

  it("is a supervisor's step: encoders do not get the button", async () => {
    auth.role = "ENCODER";
    await open();
    await screen.findAllByText("3 unpublished");
    expect(publishBtn()).toBeUndefined();
  });
});

describe("ManualCountPage - opening a published audit from Audit History", () => {
  it("downloads the frozen copy that the publish saved, instead of rebuilding from the live counts", async () => {
    api.getAuditSnapshot.mockResolvedValue({
      id: 5,
      entryDate: "2026-10-09",
      shift: "NIGHT",
      publishedAt: "2026-10-10T01:00:00.000Z",
      appliedToOpening: false,
      rows: [{ location: "ONLINE", productId: 1, sku: "SKU1", name: "Soy Sauce", category: "Sauces", systemRemainingStock: 10, manualCount: 8, variance: 2, isOpeningBalance: false, remarks: null }],
    });
    render(
      <MemoryRouter initialEntries={["/manual-count?history=1&snapshot=5"]}>
        <ManualCountPage />
      </MemoryRouter>,
    );
    await waitFor(() => expect(pdf.downloadTablePdf).toHaveBeenCalledTimes(1));
    expect(api.getAuditSnapshot).toHaveBeenCalledWith(5);
    expect(pdf.downloadTablePdf.mock.calls[0][0]).toMatchObject({ filename: "audit-published-2026-10-09-night.pdf", title: "Manual Counting & Variance" });
  });
});
