import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ReactNode } from "react";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { CorrectionsPage } from "./CorrectionsPage";

const api = vi.hoisted(() => ({ listCorrections: vi.fn(), approveCorrection: vi.fn(), rejectCorrection: vi.fn(), STALE_OPENING_FIELD: "openingStock" }));
vi.mock("../api/ops", () => api);
vi.mock("../context/AuthContext", () => ({ useAuth: () => ({ user: { id: 1, role: "SUPERVISOR_ADMIN" } }) }));
vi.mock("../context/RealtimeContext", () => ({ useRealtimeVersion: () => 0 }));
vi.mock("../components/PageHeader", () => ({ PageHeader: ({ children }: { children?: ReactNode }) => <div>{children}</div> }));

let id = 0;
const correction = (over: Record<string, unknown> = {}) => ({
  id: ++id,
  tableName: "daily_online_stock",
  recordId: 50,
  field: "fulfillmentOut",
  beforeValue: "10",
  proposedValue: "4",
  appliedBefore: null,
  reason: "Typed the wrong figure",
  status: "PENDING",
  requestedAt: "2026-10-16T01:00:00.000Z",
  requestedBy: { id: 3, name: "Ana Cruz" },
  reviewedAt: null,
  reviewedBy: null,
  reviewNote: null,
  events: [{ id: 1, event: "REQUESTED", at: "2026-10-16T01:00:00.000Z", note: "Typed the wrong figure", by: { id: 3, name: "Ana Cruz" } }],
  ...over,
});

beforeEach(() => {
  vi.clearAllMocks();
  id = 0;
  api.listCorrections.mockResolvedValue({ items: [correction()], total: 1 });
});

describe("CorrectionsPage approval", () => {
  it("approves one figure by default, without touching the finished days after it", async () => {
    api.approveCorrection.mockResolvedValue({ snapshotsRefreshed: ["2026-10-10"] });
    render(<CorrectionsPage />);
    fireEvent.click(await screen.findByRole("button", { name: "Approve" }));
    const dialog = await screen.findByRole("dialog");
    const cascade = within(dialog).getByRole("checkbox") as HTMLInputElement;
    expect(cascade.checked).toBe(false);

    fireEvent.click(within(dialog).getByRole("button", { name: "Approve" }));
    await waitFor(() => expect(api.approveCorrection).toHaveBeenCalledWith(1, undefined, false));
    expect(await screen.findByText("Approved. The saved report for 2026-10-10 was updated.")).toBeTruthy();
  });

  it("can approve with the consequences for later finished days when that is chosen", async () => {
    api.approveCorrection.mockResolvedValue({});
    render(<CorrectionsPage />);
    fireEvent.click(await screen.findByRole("button", { name: "Approve" }));
    const dialog = await screen.findByRole("dialog");
    fireEvent.click(within(dialog).getByRole("checkbox"));
    fireEvent.click(within(dialog).getByRole("button", { name: "Approve" }));
    await waitFor(() => expect(api.approveCorrection).toHaveBeenCalledWith(1, undefined, true));
  });

  it("starts each approval unticked, even after a previous one was ticked", async () => {
    api.approveCorrection.mockResolvedValue({});
    api.listCorrections.mockResolvedValue({ items: [correction(), correction({ recordId: 51 })], total: 2 });
    render(<CorrectionsPage />);
    const approveButtons = await screen.findAllByRole("button", { name: "Approve" });
    fireEvent.click(approveButtons[0]);
    fireEvent.click(within(await screen.findByRole("dialog")).getByRole("checkbox"));
    fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Cancel" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());

    fireEvent.click(screen.getAllByRole("button", { name: "Approve" })[1]);
    expect((within(await screen.findByRole("dialog")).getByRole("checkbox") as HTMLInputElement).checked).toBe(false);
  });

  it("labels a held opening stock as a carry-forward and says it is worked out again on approval", async () => {
    api.listCorrections.mockResolvedValue({
      items: [correction({ field: "openingStock", beforeValue: "80", proposedValue: "180", reason: "Held for approval: an earlier period changed" })],
      total: 1,
    });
    render(<CorrectionsPage />);
    expect(await screen.findByText(/opening stock \(carried forward\)/)).toBeTruthy();
    expect(screen.getByText(/worked out again when you approve/)).toBeTruthy();
  });

  it("keeps the dialog open with the server's message when approval is refused", async () => {
    api.approveCorrection.mockRejectedValue(new Error("That request was already approved."));
    render(<CorrectionsPage />);
    fireEvent.click(await screen.findByRole("button", { name: "Approve" }));
    fireEvent.click(within(await screen.findByRole("dialog")).getByRole("button", { name: "Approve" }));
    expect(await screen.findByText("That request was already approved.")).toBeTruthy();
    expect(screen.getByRole("dialog")).toBeTruthy();
  });
});
