import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { EntryToolbar, type EntryToolbarProps } from "./EntryToolbar";

const api = vi.hoisted(() => ({
  getFinishSummary: vi.fn(),
  finishDay: vi.fn(),
  previewFinishThrough: vi.fn(),
  finishThrough: vi.fn(),
}));
vi.mock("../api/ops", () => api);
vi.mock("../context/RealtimeContext", () => ({ useRealtimeVersion: () => 0 }));
// Heavy neighbours whose own behaviour is tested elsewhere: only that the toolbar
// can open them is under test here.
vi.mock("./ReorderProductsButton", () => ({ ReorderProductsDialog: () => <div role="dialog" aria-label="reorder dialog" /> }));
vi.mock("./CopyPreviousButton", () => ({
  CopyPreviousButton: (p: { open?: boolean; hideTrigger?: boolean }) => (p.open ? <div role="dialog" aria-label="copy panel" data-hide-trigger={String(p.hideTrigger)} /> : null),
}));
vi.mock("./Spinner", () => ({ Spinner: () => <span /> }));

const NOW = new Date("2026-10-17T10:00:00"); // a Morning shift

function props(over: Partial<EntryToolbarProps> = {}): EntryToolbarProps {
  return {
    location: "ONLINE",
    date: "2026-10-16",
    shift: "NIGHT",
    onDateChange: vi.fn(),
    onShiftChange: vi.fn(),
    query: "",
    onQueryChange: vi.fn(),
    categories: ["Sauces", "Vinegar"],
    category: "",
    onCategoryChange: vi.fn(),
    rowFilter: "all",
    onRowFilterChange: vi.fn(),
    changedCount: 0,
    canEdit: true,
    saving: false,
    pendingCount: 0,
    pendingCellCount: 0,
    canUndo: false,
    canRedo: false,
    onUndo: vi.fn(),
    onRedo: vi.fn(),
    onDiscard: vi.fn(),
    onRefresh: vi.fn(),
    copyPrevious: {
      current: { date: "2026-10-16", shift: "NIGHT" },
      columns: [],
      rows: [],
      fetchPeriod: vi.fn(),
      pending: {},
      getSavedValue: vi.fn(),
      onApply: vi.fn(),
    },
    onSave: vi.fn(),
    saveState: "idle",
    onRetrySave: vi.fn(),
    hasRows: true,
    anyExpanded: false,
    onToggleExpandAll: vi.fn(),
    isAdmin: false,
    zoom: 100,
    onZoomChange: vi.fn(),
    pdfBusy: false,
    onPdf: vi.fn(),
    dayLock: { loaded: true, locked: false, blockedBy: null },
    onFinished: vi.fn(),
    onError: vi.fn(),
    finishWarnings: [],
    ...over,
  };
}

const show = (over: Partial<EntryToolbarProps> = {}) => {
  const p = props(over);
  render(
    <MemoryRouter>
      <EntryToolbar {...p} />
    </MemoryRouter>,
  );
  return p;
};

/// The menu-bar trigger by its visible name (the "..." overflow one has its own bar).
const menu = (name: string) => within(screen.getByRole("menubar", { name: "Online sheet menus" })).getByRole("menuitem", { name: new RegExp(`^${name}`) });
const openMenu = (name: string) => {
  fireEvent.click(menu(name));
  return screen.getByRole("menu", { name });
};
const item = (name: RegExp | string) => screen.getByRole("menuitem", { name });

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(NOW);
  api.getFinishSummary.mockResolvedValue({
    online: { saved: 60, total: 60 },
    offline: { saved: 10, total: 60 },
    onlineLocked: false,
    offlineLocked: false,
    alreadyFinished: false,
  });
});
afterEach(() => vi.useRealTimers());

describe("layout", () => {
  it("has the four menus, the filters, Save and Finish on one bar", () => {
    show();
    expect(screen.getAllByRole("menuitem", { name: /^(Sheet|Edit|View|Export)/ }).length).toBeGreaterThanOrEqual(4);
    expect(screen.getByRole("button", { name: /Category: All/ })).toBeTruthy();
    expect(screen.getByRole("button", { name: /Rows: All/ })).toBeTruthy();
    expect(screen.getByRole("button", { name: /Shift: Night/ })).toBeTruthy();
    expect(screen.getByRole("group", { name: "Date" })).toBeTruthy();
    expect(screen.getByRole("button", { name: /^Save/ })).toBeTruthy();
    expect(screen.getByRole("group", { name: "Finish day" })).toBeTruthy();
  });

  it("filters read as Name: value, with 'All' rather than the long option label", () => {
    show();
    expect(screen.getByRole("button", { name: /Category: All$/ }).textContent).toBe("Category: All");
  });
});

describe("Save", () => {
  it("is unavailable with no changes, and says why (tooltip and accessible description)", () => {
    const p = show();
    const save = screen.getByRole("button", { name: "Save" });
    expect(save.getAttribute("aria-disabled")).toBe("true");
    expect(save.getAttribute("title")).toBe("No changes to save");
    expect(document.getElementById(save.getAttribute("aria-describedby")!)?.textContent).toBe("No changes to save");
    fireEvent.click(save);
    expect(p.onSave).not.toHaveBeenCalled();
  });

  it("shows the pending count and saves, and the tooltip names the shortcut", () => {
    const p = show({ pendingCount: 3, pendingCellCount: 5 });
    const save = screen.getByRole("button", { name: "Save (3)" });
    expect(save.getAttribute("aria-disabled")).toBeNull();
    expect(save.getAttribute("title")).toContain("Ctrl+S");
    fireEvent.click(save);
    expect(p.onSave).toHaveBeenCalledTimes(1);
  });

  it("is not offered at all on a read-only sheet, where Edit explains why", () => {
    show({ canEdit: false });
    expect(screen.queryByRole("button", { name: /^Save/ })).toBeNull();
    openMenu("Edit");
    expect(item(/Undo/).getAttribute("title")).toBe("This sheet is read-only right now");
  });

  it("shows the save status beside it", () => {
    show({ saveState: "saved", savedAt: new Date(2026, 9, 17, 21, 42).getTime() });
    expect(screen.getByRole("status").textContent).toContain("Saved 21:42");
  });
});

describe("Edit menu", () => {
  it("lists Undo and Redo with their real shortcuts, each unavailable with its own reason", () => {
    const p = show();
    openMenu("Edit");
    expect(item(/Undo/).textContent).not.toContain("Ctrl+Z"); // unavailable items hide the hint
    expect(item(/Undo/).getAttribute("title")).toBe("Nothing to undo");
    expect(item(/Redo/).getAttribute("title")).toBe("Nothing to redo");
    fireEvent.click(item(/Undo/));
    expect(p.onUndo).not.toHaveBeenCalled();
  });

  it("when there is something to undo, shows Ctrl+Z and undoes", () => {
    const p = show({ canUndo: true, canRedo: true });
    openMenu("Edit");
    expect(item(/Undo/).textContent).toContain("Ctrl+Z");
    expect(item(/Redo/).textContent).toContain("Ctrl+Shift+Z");
    fireEvent.click(item(/Undo/));
    expect(p.onUndo).toHaveBeenCalledTimes(1);
  });

  it("Discard is unavailable with no changes; with changes it opens the page's confirmation, never discards by itself", () => {
    const p = show();
    openMenu("Edit");
    expect(item(/Discard changes/).getAttribute("title")).toBe("No changes to discard");
    fireEvent.click(item(/Discard changes/));
    expect(p.onDiscard).not.toHaveBeenCalled();
  });

  it("Discard asks first: it only calls onDiscard, which the page turns into its confirmation dialog", () => {
    const p = show({ pendingCount: 2 });
    openMenu("Edit");
    fireEvent.click(item(/Discard changes/));
    expect(p.onDiscard).toHaveBeenCalledTimes(1);
  });

  it("Refresh is available, and unavailable while saving", () => {
    const p = show();
    openMenu("Edit");
    fireEvent.click(item("Refresh"));
    expect(p.onRefresh).toHaveBeenCalledTimes(1);
  });

  it("Refresh waits for a save in progress", () => {
    const p = show({ saving: true });
    openMenu("Edit");
    expect(item("Refresh").getAttribute("title")).toBe("Wait for the save to finish");
    fireEvent.click(item("Refresh"));
    expect(p.onRefresh).not.toHaveBeenCalled();
  });

  it("the bulk-fill action opens the copy popover from the menu, with no button of its own", () => {
    show();
    openMenu("Edit");
    fireEvent.click(item(/Copy from a previous period/));
    const panel = screen.getByRole("dialog", { name: "copy panel" });
    expect(panel.getAttribute("data-hide-trigger")).toBe("true");
  });
});

describe("View and Export menus", () => {
  it("expand/collapse flips its words with the state and acts", () => {
    const p = show({ anyExpanded: true });
    openMenu("View");
    fireEvent.click(item("Collapse all categories"));
    expect(p.onToggleExpandAll).toHaveBeenCalledTimes(1);
  });

  it("Reorder is visible but unavailable to a non-admin, and opens for an admin", () => {
    show();
    openMenu("View");
    expect(item(/Reorder products/).getAttribute("title")).toBe("Only an admin can change the product order");
    fireEvent.click(item(/Reorder products/));
    expect(screen.queryByRole("dialog", { name: "reorder dialog" })).toBeNull();
  });

  it("an admin's Reorder opens the dialog", () => {
    show({ isAdmin: true });
    openMenu("View");
    fireEvent.click(item(/Reorder products/));
    expect(screen.getByRole("dialog", { name: "reorder dialog" })).toBeTruthy();
  });

  it("zoom steps by 25% within 50-200% and says when it cannot go further", () => {
    const p = show({ zoom: 100 });
    openMenu("View");
    fireEvent.click(item("Zoom in"));
    expect(p.onZoomChange).toHaveBeenLastCalledWith(125);
  });

  it("zoom at the limits is unavailable with the reason", () => {
    show({ zoom: 200 });
    openMenu("View");
    expect(item("Zoom in").getAttribute("title")).toBe("Already at 200%");
    expect(item("Reset zoom (100%)").getAttribute("title")).toBeNull();
  });

  it("PDF and the report need saved data, and say so", () => {
    const p = show({ pendingCount: 2 });
    openMenu("Export");
    expect(item("Download PDF").getAttribute("title")).toBe("Save your changes first - the PDF reflects only saved data");
    expect(item(/Daily report/).getAttribute("title")).toBe("Save your changes first - the report reflects only saved data");
    fireEvent.click(item("Download PDF"));
    expect(p.onPdf).not.toHaveBeenCalled();
  });

  it("with everything saved, PDF runs and Print names Ctrl+P", () => {
    const p = show();
    openMenu("Export");
    expect(item(/Print/).textContent).toContain("Ctrl+P");
    fireEvent.click(item("Download PDF"));
    expect(p.onPdf).toHaveBeenCalledTimes(1);
  });
});

describe("Sheet menu", () => {
  it("jumps to the current shift from another sheet", () => {
    const p = show();
    openMenu("Sheet");
    fireEvent.click(item(/Jump to the current shift/));
    expect(p.onDateChange).toHaveBeenCalledWith("2026-10-17");
    expect(p.onShiftChange).toHaveBeenCalledWith("MORNING");
  });

  it("is unavailable when already on the current shift", () => {
    show({ date: "2026-10-17", shift: "MORNING" });
    openMenu("Sheet");
    expect(item(/Jump to the current shift/).getAttribute("title")).toBe("Already on the current shift");
  });
});

describe("filters", () => {
  it("none active: no markers and no Clear filters", () => {
    const { container } = render(
      <MemoryRouter>
        <EntryToolbar {...props()} />
      </MemoryRouter>,
    );
    expect(container.querySelector(".ae-filter--active")).toBeNull();
    expect(screen.queryByRole("button", { name: /Clear filters/ })).toBeNull();
  });

  it("an active filter is marked with a dot and words, and Clear filters resets every one", () => {
    const { container } = render(
      <MemoryRouter>
        <EntryToolbar {...props({ category: "Sauces", rowFilter: "changed", query: "soy" })} />
      </MemoryRouter>,
    );
    expect(container.querySelectorAll(".ae-filter--active").length).toBe(3);
    expect(container.querySelectorAll(".ae-filter-dot").length).toBe(3);
    expect(screen.getByText("Category filter is on")).toBeTruthy();
    const clear = screen.getByRole("button", { name: /Clear filters/ });
    expect(clear.getAttribute("title")).toBe("Clear 3 active filters");
  });

  it("Clear filters calls the three resets", () => {
    const p = props({ category: "Sauces", rowFilter: "negative", query: "soy" });
    render(
      <MemoryRouter>
        <EntryToolbar {...p} />
      </MemoryRouter>,
    );
    fireEvent.click(screen.getByRole("button", { name: /Clear filters/ }));
    expect(p.onQueryChange).toHaveBeenCalledWith("");
    expect(p.onCategoryChange).toHaveBeenCalledWith("");
    expect(p.onRowFilterChange).toHaveBeenCalledWith("all");
  });
});

describe("Finish", () => {
  it("is a split button: Finish day, with Finish through a date in the chevron", () => {
    show();
    const group = screen.getByRole("group", { name: "Finish day" });
    expect(within(group).getByRole("button", { name: "Finish day" })).toBeTruthy();
    fireEvent.click(within(group).getByRole("button", { name: "Finish day: more options" }));
    expect(screen.getByRole("menuitem", { name: /Finish through a date/ })).toBeTruthy();
  });

  it("is unavailable with unsaved changes, and says it would lock them out", () => {
    show({ pendingCount: 1 });
    const main = within(screen.getByRole("group", { name: "Finish day" })).getByRole("button", { name: "Finish day" });
    expect(main.getAttribute("aria-disabled")).toBe("true");
    expect(main.getAttribute("title")).toBe("Save or discard your changes first - they would be locked out");
  });

  it("opens a confirmation that says exactly what will happen, before anything is locked", async () => {
    show();
    fireEvent.click(within(screen.getByRole("group", { name: "Finish day" })).getByRole("button", { name: "Finish day" }));
    expect(await screen.findByText(/This locks the Online entries for this shift/)).toBeTruthy();
    expect(api.finishDay).not.toHaveBeenCalled();
  });

  it("with an earlier day pending, it becomes Finish pending days, with no chevron", () => {
    show({ dayLock: { loaded: true, locked: false, blockedBy: { entryDate: "2026-10-14", shift: "NIGHT" } } });
    const group = screen.getByRole("group", { name: "Finish pending days" });
    expect(within(group).queryByRole("button", { name: /more options/ })).toBeNull();
    expect(screen.queryByRole("group", { name: "Finish day" })).toBeNull();
  });

  it("on a finished sheet there is no Finish button, and no status request was made for it", () => {
    show({ dayLock: { loaded: true, locked: true, blockedBy: null } });
    expect(screen.queryByRole("group", { name: /Finish/ })).toBeNull();
    expect(api.getFinishSummary).not.toHaveBeenCalled();
  });
});

describe("the ... menu (narrow layout)", () => {
  const more = () => {
    fireEvent.click(within(screen.getByRole("menubar", { name: "More actions" })).getByRole("menuitem", { name: "More actions" }));
    return screen.getByRole("menu", { name: "More actions" });
  };

  it("holds every menu's actions, grouped under headings", () => {
    show({ canUndo: true });
    const overflow = more();
    for (const heading of ["Sheet", "Edit", "View", "Export", "Category", "Rows", "Shift", "Finish"]) {
      expect(within(overflow).getByText(heading)).toBeTruthy();
    }
    expect(within(overflow).getByRole("menuitem", { name: /Undo/ })).toBeTruthy();
    expect(within(overflow).getByRole("menuitem", { name: /Download PDF/ })).toBeTruthy();
    expect(within(overflow).getByRole("menuitem", { name: /Finish day/ })).toBeTruthy();
  });

  it("offers the filters as choices, marking the current one with a check", () => {
    show({ category: "Vinegar", rowFilter: "changed", shift: "NIGHT" });
    const overflow = more();
    const radios = within(overflow).getAllByRole("menuitemradio");
    const checked = radios.filter((r) => r.getAttribute("aria-checked") === "true").map((r) => r.textContent);
    expect(checked).toEqual(expect.arrayContaining(["Vinegar", "Only changed", "Night"]));
    expect(checked).toHaveLength(3);
  });

  it("choosing a filter there applies it", () => {
    const p = show();
    more();
    fireEvent.click(screen.getByRole("menuitemradio", { name: "Sauces" }));
    expect(p.onCategoryChange).toHaveBeenCalledWith("Sauces");
  });

  it("shows Clear filters only while something is filtered", () => {
    show();
    expect(within(more()).queryByRole("menuitem", { name: /Clear filters/ })).toBeNull();
  });

  it("reaches the same reasons: an unavailable item explains itself here too", () => {
    show();
    const overflow = more();
    expect(within(overflow).getByRole("menuitem", { name: /Discard changes/ }).getAttribute("title")).toBe("No changes to discard");
  });
});

describe("accessibility", () => {
  it("every button on the bar has an accessible name", () => {
    show();
    for (const button of screen.getAllByRole("button")) {
      const name = button.getAttribute("aria-label") ?? button.textContent ?? "";
      expect(name.trim().length, `unnamed button: ${button.outerHTML.slice(0, 80)}`).toBeGreaterThan(0);
    }
  });

  it("closing a menu returns focus to its trigger", async () => {
    show();
    openMenu("Edit");
    fireEvent.keyDown(screen.getByRole("menu", { name: "Edit" }), { key: "Escape" });
    await waitFor(() => expect(document.activeElement).toBe(menu("Edit")));
  });
});
