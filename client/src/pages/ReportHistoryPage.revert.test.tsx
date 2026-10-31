import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ReactNode } from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { ReportHistoryPage } from "./ReportHistoryPage";

const history = vi.hoisted(() => ({ listReportHistory: vi.fn() }));
const counts = vi.hoisted(() => ({ getAuditSnapshotStates: vi.fn(), revertAuditSnapshot: vi.fn() }));
const auth = vi.hoisted(() => ({ role: "SUPERVISOR_ADMIN" }));
vi.mock("../api/reportHistory", () => history);
vi.mock("../api/manualCounts", () => counts);
vi.mock("../context/AuthContext", () => ({ useAuth: () => ({ user: { id: 1, role: auth.role } }) }));
vi.mock("../context/RealtimeContext", () => ({ useRealtimeVersion: () => 0 }));
vi.mock("../components/PageHeader", () => ({ PageHeader: ({ children }: { children?: ReactNode }) => <div>{children}</div> }));
vi.mock("../components/PageToolbar", () => ({ PageToolbar: () => <div /> }));

const entry = (id: number, route: string) => ({
  id,
  type: "Audit Report",
  scope: "2026-10-20",
  route,
  generatedAt: "2026-10-21T01:00:00.000Z",
  section: "all",
  generatedBy: { id: 1, name: "Admin", username: "admin" },
});

function show() {
  render(
    <MemoryRouter>
      <ReportHistoryPage type="Audit Report" title="Audit History" subtitle="" backTo="/manual-count" backLabel="Back" />
    </MemoryRouter>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  auth.role = "SUPERVISOR_ADMIN";
  history.listReportHistory.mockResolvedValue({
    items: [
      entry(2, "/manual-count?history=1&snapshot=7&date=2026-10-20&shift=NIGHT&source=TOTAL"),
      entry(1, "/manual-count?history=1&date=2026-10-19&shift=NIGHT&source=TOTAL"), // only downloaded, never published
    ],
    nextCursor: null,
  });
  counts.getAuditSnapshotStates.mockResolvedValue([{ id: 7, reverted: false, revertedAt: null, canRevert: true }]);
});

describe("Audit History - revert a published audit", () => {
  it("offers Revert beside Download on a published audit only, and asks for a reason before reverting", async () => {
    counts.revertAuditSnapshot.mockResolvedValue({ snapshotId: 7, reverted: 4, keptManual: 0, heldLocked: 0 });
    show();
    const revert = await screen.findAllByRole("button", { name: "Revert" });
    expect(revert).toHaveLength(1); // the downloaded-only row has none
    expect(counts.getAuditSnapshotStates).toHaveBeenCalledWith([7]);

    fireEvent.click(revert[0]);
    const confirm = screen.getByRole("button", { name: "Revert audit" }) as HTMLButtonElement;
    expect(confirm.disabled).toBe(true);
    fireEvent.change(screen.getByLabelText("Reason for reverting"), { target: { value: "Counted the wrong shelf" } });
    fireEvent.click(confirm);

    await waitFor(() => expect(counts.revertAuditSnapshot).toHaveBeenCalledWith(7, "Counted the wrong shelf"));
    expect(await screen.findByText(/4 counts unpublished/)).toBeTruthy();
  });

  it("shows Reverted instead of the button once reverted", async () => {
    counts.getAuditSnapshotStates.mockResolvedValue([{ id: 7, reverted: true, revertedAt: "2026-10-22T01:00:00.000Z", canRevert: false }]);
    show();
    expect(await screen.findByText("Reverted")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Revert" })).toBeNull();
  });

  it("is not offered to anyone but an admin", async () => {
    auth.role = "ENCODER";
    show();
    await screen.findAllByText("Download");
    expect(screen.queryByRole("button", { name: "Revert" })).toBeNull();
  });
});
