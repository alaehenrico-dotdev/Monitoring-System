import { afterEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { ThemeProvider } from "../context/ThemeContext";
import { ThemeToggle } from "./ThemeToggle";

const root = document.documentElement;

function renderToggle() {
  localStorage.setItem("ae-theme", "light");
  return render(
    <ThemeProvider>
      <ThemeToggle />
    </ThemeProvider>,
  );
}

afterEach(() => {
  // @ts-expect-error - test cleanup of a stubbed browser API
  delete document.startViewTransition;
  root.classList.remove("ae-theme-switching");
  localStorage.clear();
});

describe("ThemeToggle", () => {
  it("without View Transitions: toggles instantly, transitions are off only briefly", async () => {
    renderToggle();
    fireEvent.click(screen.getByRole("button"));
    expect(root.dataset.theme).toBe("dark");
    expect(root.classList.contains("ae-theme-switching")).toBe(true);
    await waitFor(() => expect(root.classList.contains("ae-theme-switching")).toBe(false));
    expect(localStorage.getItem("ae-theme")).toBe("dark");
  });

  it("with View Transitions: transitions stay off until the transition finishes", async () => {
    let finish!: () => void;
    const finished = new Promise<void>((r) => (finish = r));
    const start = vi.fn((cb: () => void) => {
      cb();
      return { ready: new Promise(() => {}), finished, skipTransition: vi.fn() };
    });
    (document as unknown as { startViewTransition: unknown }).startViewTransition = start;

    renderToggle();
    fireEvent.click(screen.getByRole("button"));
    expect(start).toHaveBeenCalledTimes(1);
    expect(root.dataset.theme).toBe("dark");
    expect(root.classList.contains("ae-theme-switching")).toBe(true);

    await act(async () => {
      finish();
      await finished;
    });
    expect(root.classList.contains("ae-theme-switching")).toBe(false);
  });

  it("a rapid second click skips the in-flight transition and keeps transitions off until the last one ends", async () => {
    const finishers: (() => void)[] = [];
    const skips: ReturnType<typeof vi.fn>[] = [];
    const start = vi.fn((cb: () => void) => {
      cb();
      const skip = vi.fn();
      skips.push(skip);
      let resolve!: () => void;
      const finished = new Promise<void>((r) => (resolve = r));
      finishers.push(resolve);
      return { ready: new Promise(() => {}), finished, skipTransition: skip };
    });
    (document as unknown as { startViewTransition: unknown }).startViewTransition = start;

    renderToggle();
    const button = screen.getByRole("button");
    fireEvent.click(button);
    fireEvent.click(button);
    expect(skips[0]).toHaveBeenCalledTimes(1);
    expect(root.dataset.theme).toBe("light");

    // The skipped transition finishing must NOT re-enable transitions early.
    await act(async () => {
      finishers[0]();
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(root.classList.contains("ae-theme-switching")).toBe(true);

    await act(async () => {
      finishers[1]();
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(root.classList.contains("ae-theme-switching")).toBe(false);
  });
});
