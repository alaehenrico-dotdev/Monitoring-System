import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MonthCloseTab } from "./MonthCloseTab";

const api = vi.hoisted(() => ({ listMonthClosures: vi.fn(), getMonthReadiness: vi.fn(), closeMonth: vi.fn(), unlockMonth: vi.fn() }));
vi.mock("../api/ops", () => api);

const ready = (over: Record<string, unknown> = {}) => ({ yearMonth: "2026-09", ready: true, problems: [], warnings: [], periodsWithEntries: 58, ...over });
const closedRow = { id: 1, yearMonth: "2026-09", isClosed: true, closedAt: "2026-10-02T01:00:00.000Z", closedBy: { id: 1, name: "Admin" }, unlockedAt: null, unlockedBy: null, unlockReason: null };

beforeEach(() => {
  vi.clearAllMocks();
  // Only the clock is faked: timers stay real so Testing Library's waits still work.
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-10-17T10:00:00"));
  api.listMonthClosures.mockResolvedValue([]);
  api.getMonthReadiness.mockResolvedValue(ready());
});

describe("MonthCloseTab", () => {
  it("starts on the month that just ended and offers to close it when it is ready", async () => {
    render(<MonthCloseTab />);
    expect(await screen.findByText("Ready to close")).toBeTruthy();
    expect(api.getMonthReadiness).toHaveBeenCalledWith("2026-09");
    expect((screen.getByRole("button", { name: "Close month" }) as HTMLButtonElement).disabled).toBe(false);
  });

  it("lists what is in the way and will not close", async () => {
    api.getMonthReadiness.mockResolvedValue(
      ready({ ready: false, problems: ["3 count(s) in 2026-09 are still unpublished."], warnings: ["No entries at all on 1 day(s): 2026-09-05."] }),
    );
    render(<MonthCloseTab />);
    expect(await screen.findByText("Not ready")).toBeTruthy();
    expect(within(screen.getByRole("list", { name: "Problems" })).getByText(/still unpublished/)).toBeTruthy();
    expect(within(screen.getByRole("list", { name: "Warnings" })).getByText(/No entries at all/)).toBeTruthy();
    expect((screen.getByRole("button", { name: "Close month" }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("asks before closing, then closes", async () => {
    api.closeMonth.mockResolvedValue({});
    render(<MonthCloseTab />);
    await screen.findByText("Ready to close");
    fireEvent.click(screen.getByRole("button", { name: "Close month" }));
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByText(/will be refused from now on/)).toBeTruthy();
    fireEvent.click(within(dialog).getByRole("button", { name: "Close month" }));
    await waitFor(() => expect(api.closeMonth).toHaveBeenCalledWith("2026-09"));
    expect(await screen.findByText("2026-09 is closed.")).toBeTruthy();
  });

  it("shows a closed month as closed and unlocks it only with a reason", async () => {
    api.listMonthClosures.mockResolvedValue([closedRow]);
    api.unlockMonth.mockResolvedValue({});
    render(<MonthCloseTab />);
    fireEvent.click(await screen.findByRole("button", { name: "Unlock…" }));
    const dialog = await screen.findByRole("dialog");
    const unlock = within(dialog).getByRole("button", { name: "Unlock" }) as HTMLButtonElement;
    expect(unlock.disabled).toBe(true);
    fireEvent.change(within(dialog).getByLabelText("Reason for unlocking"), { target: { value: "Late supplier invoice" } });
    fireEvent.click(unlock);
    await waitFor(() => expect(api.unlockMonth).toHaveBeenCalledWith("2026-09", "Late supplier invoice"));
  });

  it("keeps the dialog open and shows the server's message when closing is refused", async () => {
    api.closeMonth.mockRejectedValue(new Error("2026-09 can't be closed yet: 1 page(s) are not finished."));
    render(<MonthCloseTab />);
    await screen.findByText("Ready to close");
    fireEvent.click(screen.getByRole("button", { name: "Close month" }));
    fireEvent.click(within(await screen.findByRole("dialog")).getByRole("button", { name: "Close month" }));
    expect(await screen.findByText(/can't be closed yet/)).toBeTruthy();
    expect(screen.getByRole("dialog")).toBeTruthy();
  });
});
