import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { FinishThroughButton } from "./FinishThrough";

const api = vi.hoisted(() => ({ previewFinishThrough: vi.fn(), finishThrough: vi.fn() }));
vi.mock("../api/ops", () => api);

const plan = (over: Record<string, unknown> = {}) => ({
  location: "ONLINE",
  throughDate: "2026-10-14",
  periods: [
    { entryDate: "2026-10-12", shift: "NIGHT", saved: 55 },
    { entryDate: "2026-10-13", shift: "NIGHT", saved: 56 },
  ],
  blockers: [],
  warnings: [],
  canFinish: true,
  ...over,
});

function setup(props: Partial<React.ComponentProps<typeof FinishThroughButton>> = {}) {
  const onFinished = vi.fn();
  const onError = vi.fn();
  render(<FinishThroughButton defaultDate="2026-10-14" location="ONLINE" disabled={false} onFinished={onFinished} onError={onError} {...props} />);
  return { onFinished, onError, open: () => fireEvent.click(screen.getByRole("button", { name: /Finish pending days/ })) };
}

const confirmButton = () => screen.getByRole("button", { name: /^Finish( \d+ shifts?)?$/ }) as HTMLButtonElement;

beforeEach(() => vi.clearAllMocks());

describe("FinishThroughButton", () => {
  it("shows exactly which shifts would be locked, then finishes them", async () => {
    api.previewFinishThrough.mockResolvedValue(plan());
    api.finishThrough.mockResolvedValue({ finished: 2, periods: [], warnings: [], snapshots: [] });
    const { open, onFinished } = setup();
    open();

    expect(await screen.findByText("2 shifts will be locked")).toBeTruthy();
    expect(api.previewFinishThrough).toHaveBeenCalledWith("2026-10-14", "ONLINE");
    const list = screen.getByRole("list", { name: "Shifts to finish" });
    expect(list.textContent).toContain("55 products saved");

    fireEvent.click(confirmButton());
    expect(await screen.findByText(/2 Online shifts up to .* are saved and locked/)).toBeTruthy();
    expect(api.finishThrough).toHaveBeenCalledWith("2026-10-14", "ONLINE", false);
    expect(onFinished).toHaveBeenCalled();
  });

  it("cannot be confirmed while there is a blocker, and says why", async () => {
    api.previewFinishThrough.mockResolvedValue(plan({ blockers: ["2 product row(s) end below zero stock in this range. Correct them before finishing."], canFinish: false }));
    const { open } = setup();
    open();

    expect(await screen.findByRole("alert", { name: "Problems" })).toBeTruthy();
    expect(screen.getByText(/end below zero stock/)).toBeTruthy();
    expect(confirmButton().disabled).toBe(true);
    expect(screen.queryByRole("checkbox")).toBeNull(); // a blocker cannot be acknowledged away
  });

  it("needs the warnings acknowledged before it will finish, and tells the server it was", async () => {
    api.previewFinishThrough.mockResolvedValue(plan({ warnings: ["4 item(s) are still awaiting release."] }));
    api.finishThrough.mockResolvedValue({ finished: 2, periods: [], warnings: [], snapshots: [] });
    const { open } = setup();
    open();

    await screen.findByText(/awaiting release/);
    expect(confirmButton().disabled).toBe(true);
    fireEvent.click(screen.getByRole("checkbox"));
    expect(confirmButton().disabled).toBe(false);

    fireEvent.click(confirmButton());
    await screen.findByText(/saved and locked/);
    expect(api.finishThrough).toHaveBeenCalledWith("2026-10-14", "ONLINE", true);
  });

  it("says so, and offers nothing to confirm, when everything is already finished", async () => {
    api.previewFinishThrough.mockResolvedValue(plan({ periods: [], canFinish: false }));
    const { open } = setup();
    open();
    expect(await screen.findByText(/Nothing to finish/)).toBeTruthy();
    expect(confirmButton().disabled).toBe(true);
  });

  it("reports a server refusal and closes, rather than pretending it worked", async () => {
    api.previewFinishThrough.mockResolvedValue(plan());
    api.finishThrough.mockRejectedValue(new Error("Finish 2026-10-12 first"));
    const { open, onError, onFinished } = setup();
    open();
    await screen.findByText("2 shifts will be locked");
    fireEvent.click(confirmButton());
    await waitFor(() => expect(onError).toHaveBeenCalledWith("Finish 2026-10-12 first"));
    expect(onFinished).not.toHaveBeenCalled();
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("does not open with unsaved edits, and explains why", () => {
    const { open, onError } = setup({ disabled: true, disabledReason: "Save first" });
    open();
    expect(onError).toHaveBeenCalledWith("Save first");
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(api.previewFinishThrough).not.toHaveBeenCalled();
  });

  it("shows the load error instead of a plan when the check fails", async () => {
    api.previewFinishThrough.mockRejectedValue(new Error("offline"));
    const { open } = setup();
    open();
    expect(await screen.findByText("offline")).toBeTruthy();
    expect(confirmButton().disabled).toBe(true);
  });
});
