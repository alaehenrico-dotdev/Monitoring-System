import { afterEach, describe, expect, it } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { StickyToast } from "./Toast";

// Real timers with short delays (the animation library keeps global frame state that does not survive
// fake timers being switched on and off between tests).
const AUTO_HIDE = 150;
const DWELL = 200;
const shown = () => screen.queryByText(/1 unsaved change/);
const tab = () => screen.queryByRole("button", { name: /Show the notice/ });
const sleep = (ms: number) => act(() => new Promise<void>((r) => setTimeout(r, ms)));

function toast(props: Partial<React.ComponentProps<typeof StickyToast>> = {}) {
  return (
    <StickyToast show dismissible autoHideMs={AUTO_HIDE} revealTab tabLabel="1 unsaved" revealDelayMs={DWELL} {...props}>
      1 unsaved change in 1 product
    </StickyToast>
  );
}

afterEach(cleanup);

describe("StickyToast, hideable", () => {
  it("hides with the X and leaves a tab; moving the pointer around the corner does not bring it back", async () => {
    render(toast({ autoHideMs: undefined }));
    expect(shown()).toBeTruthy();
    expect(tab()).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Hide" }));
    await waitFor(() => expect(shown()).toBeNull());
    await waitFor(() => expect(tab()).toBeTruthy());

    // Pointer movement anywhere, the bottom-right corner included, does nothing.
    fireEvent.mouseMove(window, { clientX: 1000, clientY: 750 });
    await sleep(DWELL * 2);
    expect(shown()).toBeNull();
  });

  it("brings the toast back when the pointer rests on the tab, not when it only passes over it", async () => {
    render(toast({ autoHideMs: undefined }));
    fireEvent.click(screen.getByRole("button", { name: "Hide" }));
    await waitFor(() => expect(tab()).toBeTruthy());

    // Passing over: in and out before the delay.
    fireEvent.mouseEnter(tab()!);
    await sleep(DWELL / 3);
    fireEvent.mouseLeave(tab()!);
    await sleep(DWELL * 2);
    expect(shown()).toBeNull();

    // Resting on it for the whole delay.
    fireEvent.mouseEnter(tab()!);
    await waitFor(() => expect(shown()).toBeTruthy(), { timeout: 2000 });
    await waitFor(() => expect(tab()).toBeNull());
  });

  it("brings the toast back at once on a click or tap on the tab", async () => {
    render(toast({ autoHideMs: undefined }));
    fireEvent.click(screen.getByRole("button", { name: "Hide" }));
    await waitFor(() => expect(tab()).toBeTruthy());
    fireEvent.click(tab()!);
    await waitFor(() => expect(shown()).toBeTruthy());
  });

  it("hides by itself after the timeout, leaving the tab", async () => {
    render(toast());
    expect(shown()).toBeTruthy();
    await waitFor(() => expect(shown()).toBeNull(), { timeout: 2000 });
    await waitFor(() => expect(tab()).toBeTruthy());
  });

  it("waits while the pointer is on the toast, then hides once it leaves", async () => {
    render(toast());
    const el = screen.getByRole("status");
    fireEvent.mouseEnter(el);
    await sleep(AUTO_HIDE * 3);
    expect(shown()).toBeTruthy();

    fireEvent.mouseLeave(el);
    await waitFor(() => expect(shown()).toBeNull(), { timeout: 2000 });
  });

  it("does not stay 'held' after the toast went away under the pointer", async () => {
    render(toast());
    const el = screen.getByRole("status");
    fireEvent.mouseEnter(el); // the pointer is on it, so the timer waits...
    fireEvent.click(screen.getByRole("button", { name: "Hide" })); // ...and it goes away with no mouseleave
    await waitFor(() => expect(tab()).toBeTruthy());

    fireEvent.click(tab()!);
    await waitFor(() => expect(shown()).toBeTruthy());
    // It must hide by itself again, without the pointer having to enter and leave first.
    await waitFor(() => expect(shown()).toBeNull(), { timeout: 2000 });
  });

  it("never auto-hides a failure", async () => {
    render(toast({ failed: true, variant: "error" }));
    await sleep(AUTO_HIDE * 3);
    expect(shown()).toBeTruthy();
    expect(tab()).toBeNull();
  });

  it("shows again for a new pending session after it was closed", async () => {
    const { rerender } = render(toast({ autoHideMs: undefined }));
    fireEvent.click(screen.getByRole("button", { name: "Hide" }));
    await waitFor(() => expect(tab()).toBeTruthy());

    // Nothing pending any more (the tab goes too), then a new edit.
    rerender(toast({ autoHideMs: undefined, show: false }));
    await waitFor(() => expect(tab()).toBeNull());
    rerender(toast({ autoHideMs: undefined, show: true }));
    await waitFor(() => expect(shown()).toBeTruthy());
  });

  it("without the options it behaves as before: no X, no timeout, no tab", async () => {
    render(<StickyToast show>Pending</StickyToast>);
    await sleep(400);
    expect(screen.getByText("Pending")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Hide" })).toBeNull();
    expect(tab()).toBeNull();
  });
});
