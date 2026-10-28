import { act, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ThemeProvider } from "../context/ThemeContext";
import { JumpscareHost } from "./JumpscareHost";

function mount(ui: string) {
  localStorage.setItem("ae-ui", ui);
  return render(
    <ThemeProvider>
      <JumpscareHost />
    </ThemeProvider>,
  );
}

describe("JumpscareHost", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    // The shortest wait (2 minutes), so the tests know exactly when it fires.
    vi.spyOn(Math, "random").mockReturnValue(0);
    localStorage.clear();
  });
  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it("shows nothing in any theme but Halloween, however long it waits", () => {
    const { container } = mount("classic");
    act(() => void vi.advanceTimersByTime(10 * 60_000));
    expect(container.querySelector(".ae-jumpscare")).toBeNull();
  });

  it("appears after a couple of minutes in Halloween, then goes away by itself", () => {
    const { container } = mount("halloween");
    expect(container.querySelector(".ae-jumpscare")).toBeNull();
    act(() => void vi.advanceTimersByTime(2 * 60_000 + 100));
    expect(container.querySelector(".ae-jumpscare")).not.toBeNull();
    act(() => void vi.advanceTimersByTime(2_500));
    expect(container.querySelector(".ae-jumpscare")).toBeNull();
  });

  it("is dismissed by a key press", () => {
    const { container } = mount("halloween");
    act(() => void vi.advanceTimersByTime(2 * 60_000 + 100));
    act(() => void window.dispatchEvent(new KeyboardEvent("keydown", { key: "a" })));
    expect(container.querySelector(".ae-jumpscare")).toBeNull();
    expect(screen.queryByRole("presentation")).toBeNull();
  });
});
