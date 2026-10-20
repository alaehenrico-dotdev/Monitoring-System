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
  onlineLocked: false,
  offlineLocked: false,
  alreadyFinished,
});

function setup(props: Partial<React.ComponentProps<typeof FinishDayButton>> = {}) {
  const onError = vi.fn();
  render(
    <MemoryRouter>
      <FinishDayButton date="2026-10-14" shift="NIGHT" location="ONLINE" disabled={false} onFinished={vi.fn()} onError={onError} {...props} />
    </MemoryRouter>,
  );
  return { onError, button: () => screen.getByRole("button", { name: /Finish day/ }) };
}

beforeEach(() => vi.clearAllMocks());

describe("FinishDayButton", () => {
  it("glows once every product is saved on its own page, whatever the other page has", async () => {
    api.getFinishSummary.mockResolvedValue(summary(60, 10));
    const { button } = setup();
    await waitFor(() => expect(button().classList.contains("ae-toolbar-publish--ready")).toBe(true));
  });

  it("finishes only its own page and says the report waits for the other", async () => {
    api.getFinishSummary.mockResolvedValue(summary(60, 10));
    api.finishDay.mockResolvedValue({ ...summary(60, 10, true), finished: true, reportSaved: false });
    const { button } = setup();
    await waitFor(() => expect(api.getFinishSummary).toHaveBeenCalledWith("2026-10-14", "NIGHT", "ONLINE"));
    fireEvent.click(button());
    fireEvent.click(await screen.findByRole("button", { name: /Finish & lock/ }));
    expect(await screen.findByText(/saved once Offline is finished too/)).toBeTruthy();
    expect(api.finishDay).toHaveBeenCalledWith("2026-10-14", "NIGHT", "ONLINE");
  });

  describe("negative stock", () => {
    const withNegatives = () => ({ ...summary(60, 60), negatives: [{ productId: 3, name: "APPLE", remainingStock: -5 }] });

    it("blocks an encoder and says to ask a supervisor", async () => {
      api.getFinishSummary.mockResolvedValue(withNegatives());
      const { button } = setup();
      await waitFor(() => expect(api.getFinishSummary).toHaveBeenCalled());
      fireEvent.click(button());
      expect(await screen.findByText(/APPLE \(-5\)/)).toBeTruthy();
      expect(screen.getByText(/ask a supervisor/)).toBeTruthy();
      expect((screen.getByRole("button", { name: /Finish & lock/ }) as HTMLButtonElement).disabled).toBe(true);
    });

    it("lets a supervisor finish once a reason is given, and sends it", async () => {
      api.getFinishSummary.mockResolvedValue(withNegatives());
      api.finishDay.mockResolvedValue({ ...summary(60, 60, true), finished: true, reportSaved: false });
      const { button } = setup({ canSignOff: true });
      await waitFor(() => expect(api.getFinishSummary).toHaveBeenCalled());
      fireEvent.click(button());
      const lock = await screen.findByRole("button", { name: /Finish & lock/ });
      expect((lock as HTMLButtonElement).disabled).toBe(true);
      fireEvent.change(screen.getByLabelText(/Reason to finish with negative stock/), { target: { value: "In arrives next shift" } });
      expect((lock as HTMLButtonElement).disabled).toBe(false);
      fireEvent.click(lock);
      await waitFor(() => expect(api.finishDay).toHaveBeenCalledWith("2026-10-14", "NIGHT", "ONLINE", "In arrives next shift"));
    });
  });

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

describe("FinishDayButton confirmation lists what is wrong", () => {
  it("BLOCKS when nothing is saved on the page: says so and the confirm button cannot be pressed", async () => {
    api.getFinishSummary.mockResolvedValue(summary(0, 10));
    const { button } = setup();
    await waitFor(() => expect(api.getFinishSummary).toHaveBeenCalled());
    fireEvent.click(button());
    expect(await screen.findByRole("alert")).toBeTruthy();
    expect(screen.getByText(/Blocked: nothing has been saved on the Online page/)).toBeTruthy();
    const confirm = screen.getByRole("button", { name: /Finish & lock/ }) as HTMLButtonElement;
    expect(confirm.disabled).toBe(true);
    fireEvent.click(confirm);
    expect(api.finishDay).not.toHaveBeenCalled();
    // Cancel still works: the person is never stuck in the dialog.
    expect((screen.getByRole("button", { name: "Cancel" }) as HTMLButtonElement).disabled).toBe(false);
  });

  it("shows the warnings it is given, without blocking", async () => {
    api.getFinishSummary.mockResolvedValue(summary(60, 60));
    api.finishDay.mockResolvedValue({ ...summary(60, 60, true), finished: true, reportSaved: true });
    const { button } = setup({ warnings: ["2 products end below zero stock on this sheet."] });
    await waitFor(() => expect(api.getFinishSummary).toHaveBeenCalled());
    fireEvent.click(button());
    const warnings = await screen.findByRole("list", { name: "Warnings" });
    expect(warnings.textContent).toContain("2 products end below zero stock");
    const confirm = screen.getByRole("button", { name: /Finish & lock/ }) as HTMLButtonElement;
    expect(confirm.disabled).toBe(false);
    fireEvent.click(confirm);
    await waitFor(() => expect(api.finishDay).toHaveBeenCalledTimes(1));
  });

  it("a half-done sheet is a warning, not a block", async () => {
    api.getFinishSummary.mockResolvedValue(summary(40, 60));
    const { button } = setup();
    await waitFor(() => expect(api.getFinishSummary).toHaveBeenCalled());
    fireEvent.click(button());
    expect(await screen.findByText(/Some products have no saved entry yet/)).toBeTruthy();
    expect(screen.queryByRole("alert")).toBeNull();
    expect((screen.getByRole("button", { name: /Finish & lock/ }) as HTMLButtonElement).disabled).toBe(false);
  });

  it("names the products with no entry and notes the missing manual counts, without blocking", async () => {
    api.getFinishSummary.mockResolvedValue({
      ...summary(58, 60),
      missing: [{ productId: 1, name: "APPLE" }, { productId: 2, name: "BANANA" }],
      missingCount: 12,
      uncounted: 3,
    });
    const { button } = setup();
    await waitFor(() => expect(api.getFinishSummary).toHaveBeenCalled());
    fireEvent.click(button());
    expect(await screen.findByText("APPLE")).toBeTruthy();
    expect(screen.getByText("BANANA")).toBeTruthy();
    expect(screen.getByText("and 10 more")).toBeTruthy();
    expect(screen.getByText(/3 saved products have no manual count/)).toBeTruthy();
    expect((screen.getByRole("button", { name: /Finish & lock/ }) as HTMLButtonElement).disabled).toBe(false);
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
