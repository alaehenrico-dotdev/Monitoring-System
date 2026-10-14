import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { FinishDayButton, FinishEarlierDayBanner } from "./FinishDay";

const api = vi.hoisted(() => ({ getFinishSummary: vi.fn(), finishDay: vi.fn() }));
vi.mock("../api/ops", () => api);
vi.mock("../context/RealtimeContext", () => ({ useRealtimeVersion: () => 0 }));

const summary = (online: number, offline: number, alreadyFinished = false) => ({
  online: { saved: online, total: 60 },
  offline: { saved: offline, total: 60 },
  alreadyFinished,
});

function setup(props: Partial<React.ComponentProps<typeof FinishDayButton>> = {}) {
  const onError = vi.fn();
  render(
    <MemoryRouter>
      <FinishDayButton date="2026-10-14" shift="NIGHT" disabled={false} onFinished={vi.fn()} onError={onError} {...props} />
    </MemoryRouter>,
  );
  return { onError, button: () => screen.getByRole("button", { name: /Finish day/ }) };
}

beforeEach(() => vi.clearAllMocks());

describe("FinishDayButton", () => {
  it("glows once every product is saved in both grids", async () => {
    api.getFinishSummary.mockResolvedValue(summary(60, 60));
    const { button } = setup();
    await waitFor(() => expect(button().classList.contains("ae-toolbar-publish--ready")).toBe(true));
  });

  it("does not glow while products are still missing, but is still clickable", async () => {
    api.getFinishSummary.mockResolvedValue(summary(58, 60));
    const { button } = setup();
    await waitFor(() => expect(api.getFinishSummary).toHaveBeenCalled());
    expect(button().classList.contains("ae-toolbar-publish--ready")).toBe(false);
    expect((button() as HTMLButtonElement).disabled).toBe(false);
    fireEvent.click(button());
    // Asks before locking a half-done day, and says what is missing.
    expect(await screen.findByText(/Some products have no saved entry yet/)).toBeTruthy();
  });

  it("stays clickable with unsaved edits and explains why it cannot go ahead", async () => {
    api.getFinishSummary.mockResolvedValue(summary(60, 60));
    const { button, onError } = setup({ disabled: true, disabledReason: "Save first" });
    await waitFor(() => expect(api.getFinishSummary).toHaveBeenCalled());
    expect(button().classList.contains("ae-toolbar-publish--ready")).toBe(false);
    expect((button() as HTMLButtonElement).disabled).toBe(false);
    fireEvent.click(button());
    expect(onError).toHaveBeenCalledWith("Save first");
    expect(screen.queryByText(/Finish & lock/)).toBeNull();
  });

  it("does not glow for a day that is already finished", async () => {
    api.getFinishSummary.mockResolvedValue(summary(60, 60, true));
    const { button } = setup();
    await waitFor(() => expect(api.getFinishSummary).toHaveBeenCalled());
    expect(button().classList.contains("ae-toolbar-publish--ready")).toBe(false);
  });
});

describe("FinishEarlierDayBanner", () => {
  it("names the day to finish first and jumps to it", () => {
    const onGo = vi.fn();
    render(<FinishEarlierDayBanner blockedBy={{ entryDate: "2026-10-09", shift: "NIGHT" }} onGo={onGo} />);
    expect(screen.getByText(/Finish .*October 9, 2026.* first/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /Go to/ }));
    expect(onGo).toHaveBeenCalledWith("2026-10-09", "NIGHT");
  });
});
