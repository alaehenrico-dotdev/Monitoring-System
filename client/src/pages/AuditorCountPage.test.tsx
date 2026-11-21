import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ReactNode } from "react";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { AuditorCountPage } from "./AuditorCountPage";
import { requestQuickJump } from "../utils/quickJumpTarget";

const products = vi.hoisted(() => ({ listProducts: vi.fn() }));
vi.mock("../api/products", () => products);
const EDITED = "The auditor is editing their submitted count.";
const subs = vi.hoisted(() => ({ getMySubmission: vi.fn(), saveMyLines: vi.fn(), submitMySubmission: vi.fn(), editMySubmission: vi.fn(), getMyHistory: vi.fn(), EDITED_BY_AUDITOR: "The auditor is editing their submitted count." }));
vi.mock("../api/countSubmissions", () => subs);
vi.mock("../context/RealtimeContext", () => ({ useRealtimeVersion: () => 0 }));
const pdf = vi.hoisted(() => ({ downloadTablePdf: vi.fn() }));
vi.mock("../utils/tablePdf", () => pdf);
vi.mock("../context/AuthContext", () => ({ useAuth: () => ({ user: { id: 9, role: "AUDITOR" } }) }));
// The real header needs the whole app shell; what matters here is that its toolbar is rendered.
vi.mock("../components/PageHeader", () => ({
  PageHeader: ({ title, badges, children }: { title: ReactNode; badges?: ReactNode; children?: ReactNode }) => (
    <div>
      <h1>{title}</h1>
      {badges}
      {children}
    </div>
  ),
}));
vi.mock("../utils/shift", async (orig) => ({
  ...(await orig<typeof import("../utils/shift")>()),
  getCurrentShiftAndDate: () => ({ date: "2026-11-21", shift: "NIGHT" }),
}));

const P = (id: number, sku: string, name: string, category: string) => ({ id, sku, name, category, unit: "bottle", isActive: true, sortOrder: id, lowStockThreshold: null });
const LIST = [P(1, "AFP001", "Special", "Premium"), P(2, "AFP002", "Fish Sauce", "Premium"), P(3, "AFP007", "Sweet A", "Class A")];

const KEY = "ae:audit-count-draft:9:2026-11-21:NIGHT";
const DRAFT_FROM_SERVER = { status: "DRAFT", submittedAt: null, reopenedAt: null, reopenReason: null, lines: [] as unknown[] };
const SYNC_WAIT = { timeout: 5000 };
// A menu with one item is shown by the toolbar as a plain button.
const expandAll = () => fireEvent.click(screen.getAllByRole("button", { name: /Expand all categories/ })[0]);
const submitButton = () => screen.getAllByRole("button", { name: /^Submit(ted)?$/ })[0];
const box = (name: string) => screen.getByLabelText(`Count for ${name}`) as HTMLInputElement;
const rowOf = (name: string) => screen.getByText(name).closest("tr")!;
const hidden = (name: string) => rowOf(name).classList.contains("ae-row-collapsed");
const chooseDropdown = (label: string | RegExp, option: RegExp) => {
  fireEvent.click(screen.getAllByRole("button", { name: label })[0]);
  fireEvent.click(screen.getByRole("option", { name: option }));
};

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
  Element.prototype.scrollIntoView = vi.fn();
  products.listProducts.mockResolvedValue(LIST);
  subs.getMySubmission.mockResolvedValue(DRAFT_FROM_SERVER);
  subs.saveMyLines.mockResolvedValue({ saved: 1, savedAt: "2026-11-21T14:00:00.000Z" });
  subs.submitMySubmission.mockResolvedValue({ status: "SUBMITTED", submittedAt: "2026-11-21T14:00:00.000Z" });
});

/// Opens the page and expands every category (they start collapsed, like the other tables).
async function open() {
  render(<AuditorCountPage />);
  await screen.findByText("Special");
  expandAll();
  await waitFor(() => expect(hidden("Special")).toBe(false));
}

describe("AuditorCountPage", () => {
  it("starts with every category collapsed, like the other tables, and shows how much of each is counted", async () => {
    render(<AuditorCountPage />);
    await screen.findByText("Special");
    expect(hidden("Special")).toBe(true);
    const bar = screen.getByRole("button", { name: /Premium/ });
    expect(bar.getAttribute("aria-expanded")).toBe("false");
    expect(bar.textContent).toContain("0/2");
  });

  it("lists every SKU and product with an empty count box, and nothing from the system", async () => {
    await open();
    expect(screen.getByText("AFP007")).toBeTruthy();
    expect(box("Special").value).toBe("");
    // Blind count: no system figure, variance or opening stock anywhere on the sheet.
    expect(screen.queryByText(/variance|system|opening|remaining/i)).toBeNull();
    expect(screen.getByText(/counted · Online/).textContent).toContain("0 / 3");
  });

  it("counts a typed number, keeps untouched rows 'not counted' and updates the progress", async () => {
    await open();
    fireEvent.change(box("Special"), { target: { value: "12" } });
    expect(screen.getByText(/counted · Online/).textContent).toContain("1 / 3");
    expect(box("Special").className).toContain("ae-input-cell--edited");
    expect(screen.getByRole("button", { name: /Premium/ }).textContent).toContain("1/2");
    // A category with something counted takes the entry grids' blue "edited" bar; an untouched one does not.
    expect(screen.getByRole("button", { name: /Premium/ }).classList.contains("ae-cat-toggle--edited")).toBe(true);
    expect(screen.getByRole("button", { name: /Class A/ }).classList.contains("ae-cat-toggle--edited")).toBe(false);

    chooseDropdown(/Filter rows/, /Not counted/);
    await waitFor(() => expect(screen.queryByText("Special")).toBeNull());
    expect(screen.getByText("Fish Sauce")).toBeTruthy();

    chooseDropdown(/Filter rows/, /^Counted/);
    await waitFor(() => expect(screen.queryByText("Fish Sauce")).toBeNull());
    expect(screen.getByText("Special")).toBeTruthy();
  });

  it("keeps a row on screen while it is being typed in, even if the filter would hide it", async () => {
    await open();
    chooseDropdown(/Filter rows/, /Not counted/);
    await waitFor(() => expect(screen.queryByText("Sweet A")).toBeTruthy());
    fireEvent.focus(box("Special"));
    fireEvent.change(box("Special"), { target: { value: "5" } });
    expect(screen.getByText("Special")).toBeTruthy();
    fireEvent.blur(box("Special"));
    await waitFor(() => expect(screen.queryByText("Special")).toBeNull());
  });

  it("treats 0 as counted but empty as not counted, and ignores anything that is not a quantity", async () => {
    await open();
    fireEvent.click(screen.getByLabelText("Count Fish Sauce as zero"));
    expect(box("Fish Sauce").value).toBe("0");
    expect(screen.getByText(/counted · Online/).textContent).toContain("1 / 3");
    fireEvent.change(box("Special"), { target: { value: "abc" } });
    fireEvent.change(box("Special"), { target: { value: "1.234" } });
    expect(box("Special").value).toBe("");
    fireEvent.change(box("Special"), { target: { value: "2,5" } });
    expect(box("Special").value).toBe("2.5");
  });

  it("counts Online and Offline separately", async () => {
    await open();
    fireEvent.change(box("Special"), { target: { value: "7" } });
    chooseDropdown(/Where you are counting/, /Offline/);
    await waitFor(() => expect(box("Special").value).toBe(""));
    chooseDropdown(/Where you are counting/, /Online/);
    await waitFor(() => expect(box("Special").value).toBe("7"));
  });

  it("keeps what is typed on this phone and restores it after a reload, even when it could not reach the server", async () => {
    subs.saveMyLines.mockRejectedValue(new Error("offline"));
    const first = render(<AuditorCountPage />);
    await screen.findByText("Sweet A");
    fireEvent.change(box("Sweet A"), { target: { value: "40" } });
    await waitFor(() => {
      const stored = JSON.parse(localStorage.getItem(KEY) ?? "{}");
      expect(stored.draft["ONLINE:3"]).toEqual({ qty: "40", note: "" });
      expect(stored.unsynced).toContain("ONLINE:3");
    });
    first.unmount();
    render(<AuditorCountPage />);
    await screen.findByText("Sweet A");
    await waitFor(() => expect(box("Sweet A").value).toBe("40"));
  });

  it("saves a note on a row", async () => {
    await open();
    fireEvent.click(screen.getByLabelText("Add a note for Special"));
    fireEvent.change(screen.getByPlaceholderText(/Damaged/), { target: { value: "two cases crushed" } });
    fireEvent.click(screen.getByRole("button", { name: "Save note" }));
    expect(screen.getByText("two cases crushed")).toBeTruthy();
    fireEvent.click(screen.getByLabelText("Edit the note for Special"));
    expect((screen.getByPlaceholderText(/Damaged/) as HTMLTextAreaElement).value).toBe("two cases crushed");
  });

  it("puts Submit in the header beside the title, off until something is counted, and confirms before it goes", async () => {
    await open();
    expect(submitButton().getAttribute("aria-disabled")).toBe("true");
    fireEvent.click(submitButton());
    expect(screen.queryByRole("dialog")).toBeNull();

    fireEvent.change(box("Special"), { target: { value: "3" } });
    expect(submitButton().getAttribute("aria-disabled")).toBeNull();
    fireEvent.click(submitButton());
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByText(/Online and Offline are sent together/)).toBeTruthy();
    expect(subs.submitMySubmission).not.toHaveBeenCalled();
  });

  it("submits both locations, saving what was typed first, and warns when one location is empty", async () => {
    await open();
    fireEvent.change(box("Special"), { target: { value: "3" } });
    fireEvent.click(submitButton());
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByText("Online: 1 of 3 counted")).toBeTruthy();
    expect(within(dialog).getByText("Offline: 0 of 3 counted")).toBeTruthy();
    expect(within(dialog).getByText(/Offline has nothing counted/)).toBeTruthy();
    fireEvent.click(within(dialog).getByRole("button", { name: "Submit anyway" }));

    await waitFor(() => expect(subs.submitMySubmission).toHaveBeenCalledWith("2026-11-21", "NIGHT", true));
    // The typed line reached the server before the submit went.
    expect(subs.saveMyLines).toHaveBeenCalledWith("2026-11-21", "NIGHT", [{ productId: 1, location: "ONLINE", qty: 3, note: null }]);
    expect(subs.saveMyLines.mock.invocationCallOrder[0]).toBeLessThan(subs.submitMySubmission.mock.invocationCallOrder[0]);
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  });

  it("needs no empty-location acknowledgement when both locations have counts", async () => {
    await open();
    fireEvent.change(box("Special"), { target: { value: "3" } });
    chooseDropdown(/Where you are counting/, /Offline/);
    await waitFor(() => expect(box("Special").value).toBe(""));
    fireEvent.change(box("Special"), { target: { value: "0" } });
    fireEvent.click(submitButton());
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).queryByText(/has nothing counted/)).toBeNull();
    fireEvent.click(within(dialog).getByRole("button", { name: "Submit" }));
    await waitFor(() => expect(subs.submitMySubmission).toHaveBeenCalledWith("2026-11-21", "NIGHT", false));
  });

  it("locks the sheet after submitting: the button says Submitted and the boxes stop taking input", async () => {
    await open();
    fireEvent.change(box("Special"), { target: { value: "3" } });
    fireEvent.click(submitButton());
    fireEvent.click(within(await screen.findByRole("dialog")).getByRole("button", { name: "Submit anyway" }));
    await waitFor(() => expect(submitButton().textContent).toContain("Submitted"));
    expect(submitButton().getAttribute("aria-disabled")).toBe("true");
    expect(box("Special").readOnly).toBe(true);
    expect((screen.getByLabelText("Count Fish Sauce as zero") as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText(/The admin has your count/)).toBeTruthy();
  });

  it("does not submit, and says why, when the latest counts could not be saved", async () => {
    subs.saveMyLines.mockRejectedValue(new Error("offline"));
    await open();
    fireEvent.change(box("Special"), { target: { value: "3" } });
    fireEvent.click(submitButton());
    fireEvent.click(within(await screen.findByRole("dialog")).getByRole("button", { name: "Submit anyway" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(subs.submitMySubmission).not.toHaveBeenCalled();
    expect(submitButton().textContent).not.toContain("Submitted");
  });

  it("says what the server reported when the counts cannot be saved, instead of blaming the connection", async () => {
    const { ApiError } = await import("../api/http");
    subs.saveMyLines.mockRejectedValue(new ApiError(500, "Something went wrong on our side"));
    await open();
    fireEvent.change(box("Special"), { target: { value: "3" } });
    fireEvent.click(submitButton());
    fireEvent.click(within(await screen.findByRole("dialog")).getByRole("button", { name: "Submit anyway" }));
    expect(await screen.findByText(/could not be saved: Something went wrong on our side/)).toBeTruthy();
    expect(screen.queryByText(/Check your connection/)).toBeNull();
  });

  it("sends typed counts to the server a moment after the last keystroke, only the changed lines", async () => {
    await open();
    fireEvent.change(box("Special"), { target: { value: "1" } });
    fireEvent.change(box("Special"), { target: { value: "12" } });
    fireEvent.change(box("Fish Sauce"), { target: { value: "5" } });
    expect(subs.saveMyLines).not.toHaveBeenCalled();
    await waitFor(() => expect(subs.saveMyLines).toHaveBeenCalledTimes(1), SYNC_WAIT);
    const lines = subs.saveMyLines.mock.calls[0][2] as { productId: number; qty: number | null }[];
    expect(lines.map((l) => [l.productId, l.qty]).sort()).toEqual([[1, 12], [2, 5]]);

    fireEvent.change(box("Sweet A"), { target: { value: "9" } });
    await waitFor(() => expect(subs.saveMyLines).toHaveBeenCalledTimes(2), SYNC_WAIT);
    expect(subs.saveMyLines.mock.calls[1][2]).toEqual([{ productId: 3, location: "ONLINE", qty: 9, note: null }]);
  });

  it("keeps a line typed here that never reached the server over the server's older figure", async () => {
    subs.saveMyLines.mockRejectedValue(new Error("offline"));
    localStorage.setItem(KEY, JSON.stringify({ draft: { "ONLINE:1": { qty: "9", note: "" } }, unsynced: ["ONLINE:1"] }));
    subs.getMySubmission.mockResolvedValue({ ...DRAFT_FROM_SERVER, lines: [{ productId: 1, location: "ONLINE", qty: 7, note: null }] });
    await open();
    await waitFor(() => expect(box("Special").value).toBe("9"));
  });

  it("shows what the server already has", async () => {
    subs.getMySubmission.mockResolvedValue({
      ...DRAFT_FROM_SERVER,
      lines: [
        { productId: 1, location: "ONLINE", qty: 7, note: null },
        { productId: 3, location: "OFFLINE", qty: 2.5, note: "shelf B" },
      ],
    });
    await open();
    await waitFor(() => expect(box("Special").value).toBe("7"));
    expect(screen.getByText(/counted · Online/).textContent).toContain("1 / 3");
    chooseDropdown(/Where you are counting/, /Offline/);
    await waitFor(() => expect(box("Sweet A").value).toBe("2.5"));
    expect(screen.getByText("shelf B")).toBeTruthy();
  });

  it("does not lose a saved line to a server read that began before the save finished", async () => {
    await open();
    // The next read of the server (the app coming back to the front) is held back by the test.
    let release!: (v: unknown) => void;
    subs.getMySubmission.mockImplementationOnce(() => new Promise((resolve) => (release = resolve)));
    document.dispatchEvent(new Event("visibilitychange"));
    await waitFor(() => expect(subs.getMySubmission).toHaveBeenCalledTimes(2));

    // Typed and saved while that read is still out ...
    fireEvent.change(box("Special"), { target: { value: "5" } });
    await waitFor(() => expect(subs.saveMyLines).toHaveBeenCalledTimes(1), SYNC_WAIT);
    // ... and the read then comes back WITHOUT the save in it (it was answered before the save landed).
    release({ ...DRAFT_FROM_SERVER, lines: [] });
    await new Promise((r) => setTimeout(r, 50));
    expect(box("Special").value).toBe("5");
  });

  it("opens locked, with the time, when the count was already submitted", async () => {
    subs.getMySubmission.mockResolvedValue({
      status: "SUBMITTED",
      submittedAt: "2026-11-21T14:00:00.000Z",
      reopenedAt: null,
      reopenReason: null,
      lines: [{ productId: 1, location: "ONLINE", qty: 7, note: null }],
    });
    render(<AuditorCountPage />);
    await screen.findByText("Special");
    expandAll();
    await waitFor(() => expect(box("Special").readOnly).toBe(true));
    expect(box("Special").value).toBe("7");
    expect(screen.getByText(/The admin has your count/)).toBeTruthy();
    expect(submitButton().textContent).toContain("Submitted");
  });

  it("opens editable again, with the admin's reason, when the count was sent back", async () => {
    subs.getMySubmission.mockResolvedValue({
      status: "DRAFT",
      submittedAt: null,
      reopenedAt: "2026-11-21T15:00:00.000Z",
      reopenReason: "recount aisle 3",
      lines: [{ productId: 1, location: "ONLINE", qty: 7, note: null }],
    });
    render(<AuditorCountPage />);
    await screen.findByText("Special");
    expandAll();
    await waitFor(() => expect(screen.getByText(/sent this count back for a recount: recount aisle 3/)).toBeTruthy());
    expect(box("Special").readOnly).toBe(false);
    expect(box("Special").value).toBe("7");
    expect(submitButton().textContent).toBe("Submit");
  });

  it("has a calculator in the toolbar, after the category filter", async () => {
    await open();
    const category = screen.getAllByRole("button", { name: /Filter by category|Category/i })[0];
    const calculator = screen.getByRole("button", { name: "Calculator" });
    expect(category.compareDocumentPosition(calculator) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    fireEvent.click(calculator);
    expect(screen.getByRole("group", { name: "Calculator" })).toBeTruthy();
  });

  it("the corner button opens every category, then closes them all again", async () => {
    render(<AuditorCountPage />);
    await screen.findByText("Special");
    expect(hidden("Special") && hidden("Sweet A")).toBe(true);
    fireEvent.click(screen.getAllByRole("button", { name: "Expand all categories" })[0]);
    await waitFor(() => expect(hidden("Special") || hidden("Sweet A")).toBe(false));
    fireEvent.click(screen.getAllByRole("button", { name: "Collapse all categories" })[0]);
    await waitFor(() => expect(hidden("Special") && hidden("Sweet A")).toBe(true));
    expect(screen.getAllByRole("button", { name: "Expand all categories" }).length).toBeGreaterThan(0);
  });

  it("opens a category by its bar", async () => {
    render(<AuditorCountPage />);
    await screen.findByText("Special");
    fireEvent.click(screen.getByRole("button", { name: /Premium/ }));
    await waitFor(() => expect(hidden("Special")).toBe(false));
    expect(hidden("Sweet A")).toBe(true);
  });

  it("jumps to a product picked in the header search, opening its category and focusing its box", async () => {
    render(<AuditorCountPage />);
    await screen.findByText("Sweet A");
    expect(hidden("Sweet A")).toBe(true);
    act(() => requestQuickJump(3));
    await waitFor(() => expect(document.activeElement).toBe(box("Sweet A")));
    expect(hidden("Sweet A")).toBe(false);
  });

  it("'Next blank' goes to the first product not counted yet", async () => {
    await open();
    fireEvent.change(box("Special"), { target: { value: "1" } });
    fireEvent.click(screen.getByRole("button", { name: "Next blank" }));
    await waitFor(() => expect(document.activeElement).toBe(box("Fish Sauce")));
  });

  it("exports the sheet as a PDF: counts typed so far, no system figures, and no Google Drive copy", async () => {
    pdf.downloadTablePdf.mockResolvedValue(undefined);
    await open();
    fireEvent.change(box("Special"), { target: { value: "12" } });
    fireEvent.click(screen.getByLabelText("Count Fish Sauce as zero"));
    fireEvent.click(screen.getByLabelText("Add a note for Special"));
    fireEvent.change(screen.getByPlaceholderText(/Damaged/), { target: { value: "two crushed" } });
    fireEvent.click(screen.getByRole("button", { name: "Save note" }));

    fireEvent.click(screen.getAllByRole("button", { name: /^PDF/ })[0]);
    await waitFor(() => expect(pdf.downloadTablePdf).toHaveBeenCalledTimes(1));
    const spec = pdf.downloadTablePdf.mock.calls[0][0];
    expect(spec.filename).toBe("count-sheet-online-2026-11-21-night.pdf");
    expect(spec.title).toBe("Count Sheet - Online");
    expect(spec.notes).toContain("2 of 3 counted");
    expect(spec.driveCopy).toBe(false);
    const rows = spec.sections[0].rows as { kind: string; cells: unknown[] }[];
    expect(rows.filter((r) => r.kind === "group").map((r) => r.cells[0])).toEqual(["Premium", "Class A"]);
    const data = rows.filter((r) => r.kind === "data").map((r) => r.cells);
    expect(data).toEqual([
      ["AFP001", "Special", "bottle", "12", "two crushed"],
      ["AFP002", "Fish Sauce", "bottle", "0", ""],
      ["AFP007", "Sweet A", "bottle", "—", ""],
    ]);
    expect(JSON.stringify(spec)).not.toMatch(/variance|system|opening|remaining/i);
  });

  it("exports only what the filters show, and says so", async () => {
    pdf.downloadTablePdf.mockResolvedValue(undefined);
    await open();
    fireEvent.change(box("Special"), { target: { value: "1" } });
    chooseDropdown(/Filter rows/, /Not counted/);
    await waitFor(() => expect(screen.queryByText("Special")).toBeNull());
    fireEvent.click(screen.getAllByRole("button", { name: /^PDF/ })[0]);
    await waitFor(() => expect(pdf.downloadTablePdf).toHaveBeenCalled());
    const spec = pdf.downloadTablePdf.mock.calls[0][0];
    expect(spec.notes).toContain("Showing: not counted only");
    const names = (spec.sections[0].rows as { kind: string; cells: unknown[] }[]).filter((r) => r.kind === "data").map((r) => r.cells[1]);
    expect(names).toEqual(["Fish Sauce", "Sweet A"]);
  });

  it("is unavailable, with a reason, when the filters leave nothing to export", async () => {
    await open();
    chooseDropdown(/Filter rows/, /^Counted/);
    await waitFor(() => expect(screen.queryByText("Special")).toBeNull());
    const button = screen.getAllByRole("button", { name: /^PDF/ })[0];
    expect(button.getAttribute("aria-disabled")).toBe("true");
    fireEvent.click(button);
    expect(pdf.downloadTablePdf).not.toHaveBeenCalled();
  });
});

describe("AuditorCountPage - edit a submitted count and history", () => {
  const SUBMITTED = {
    status: "SUBMITTED",
    submittedAt: "2026-11-21T14:00:00.000Z",
    reopenedAt: null,
    reopenReason: null,
    lines: [{ productId: 1, location: "ONLINE", qty: 7, note: null }],
  };

  it("Edit takes a submitted count back to editable, keeping the numbers, until submitted again", async () => {
    subs.getMySubmission.mockResolvedValue(SUBMITTED);
    subs.editMySubmission.mockResolvedValue({ ...SUBMITTED, status: "DRAFT", reopenedAt: "2026-11-21T15:00:00.000Z", reopenReason: EDITED });
    render(<AuditorCountPage />);
    await screen.findByText("Special");
    expandAll();
    await waitFor(() => expect(box("Special").readOnly).toBe(true));
    fireEvent.click(screen.getByRole("button", { name: "Edit" }));
    await waitFor(() => expect(box("Special").readOnly).toBe(false));
    expect(subs.editMySubmission).toHaveBeenCalledWith("2026-11-21", "NIGHT");
    expect(box("Special").value).toBe("7");
    expect(screen.getByText(/You are editing your submitted count/)).toBeTruthy();
    expect(screen.queryByText(/admin sent this count back/)).toBeNull();
    expect(submitButton().textContent).toBe("Submit");
  });

  it("says why when the count can no longer be edited (published)", async () => {
    subs.getMySubmission.mockResolvedValue(SUBMITTED);
    subs.editMySubmission.mockRejectedValue(new Error("This count was already published, so it can no longer be edited."));
    render(<AuditorCountPage />);
    await screen.findByText("Special");
    await waitFor(() => screen.getByRole("button", { name: "Edit" }));
    fireEvent.click(screen.getByRole("button", { name: "Edit" }));
    expect(await screen.findByText(/already published/)).toBeTruthy();
    expect(submitButton().textContent).toContain("Submitted");
  });

  it("History lists the auditor's own sheets and opens an earlier one, with a way back", async () => {
    subs.getMyHistory.mockResolvedValue([
      { date: "2026-11-21", shift: "NIGHT", status: "DRAFT", submittedAt: null, counted: { ONLINE: 1, OFFLINE: 0 }, published: false },
      { date: "2026-11-20", shift: "NIGHT", status: "SUBMITTED", submittedAt: "2026-11-20T14:00:00.000Z", counted: { ONLINE: 5, OFFLINE: 4 }, published: true },
    ]);
    render(<AuditorCountPage />);
    await screen.findByText("Special");
    fireEvent.click(screen.getAllByRole("button", { name: /^History/ })[0]);
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByText("Published - locked")).toBeTruthy();
    expect(within(dialog).getByText("Not submitted")).toBeTruthy();
    expect(within(dialog).getByText(/Online 5 · Offline 4/)).toBeTruthy();
    subs.getMySubmission.mockClear();
    fireEvent.click(within(dialog).getByText(/Online 5 · Offline 4/));
    await waitFor(() => expect(subs.getMySubmission).toHaveBeenCalledWith("2026-11-20", "NIGHT"));
    expect(await screen.findByText(/earlier sheet/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Back to today" }));
    await waitFor(() => expect(subs.getMySubmission).toHaveBeenLastCalledWith("2026-11-21", "NIGHT"));
    expect(screen.queryByText(/earlier sheet/)).toBeNull();
  });
});

