import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { TypingPractice } from "./TypingPractice";

/// Opens the window, switches to the continuous Paragraphs test with a 15s timer.
function startTimed() {
  render(<TypingPractice />);
  fireEvent.click(screen.getByLabelText("Typing practice"));
  fireEvent.click(screen.getByText("Paragraphs"));
  fireEvent.click(screen.getByText("15s"));
  return screen.getByLabelText(
    "Type the passage shown above",
  ) as HTMLInputElement;
}

beforeEach(() => {
  vi.useFakeTimers();
  localStorage.clear();
});
afterEach(() => vi.useRealTimers());

describe("TypingPractice timer and results", () => {
  it("runs a 60s timer by default and offers Off plus the lengths in every mode", () => {
    render(<TypingPractice />);
    fireEvent.click(screen.getByLabelText("Typing practice"));
    expect(screen.getByText(/60s left/)).toBeTruthy(); // Mix mode, default timer
    for (const s of ["Off", "15s", "30s", "60s", "120s"])
      expect(screen.getByText(s)).toBeTruthy();
  });

  it("Off turns the timer off and the passage ends when it is typed", () => {
    render(<TypingPractice />);
    fireEvent.click(screen.getByLabelText("Typing practice"));
    fireEvent.click(screen.getByText("Off"));
    expect(screen.queryByText(/s left/)).toBeNull();
    const input = screen.getByLabelText("Type the passage shown above");
    const text = Array.from(
      document.querySelectorAll(".ae-typing-ch"),
      (c) => c.textContent ?? "",
    ).join("");
    fireEvent.change(input, { target: { value: text } });
    expect(screen.getByText("Nicely done!")).toBeTruthy();
    expect(localStorage.getItem("ae:typing-seconds")).toBe("0");
  });

  it("starts the clock on the first key and shows the results dialog when time is out", () => {
    const input = startTimed();
    expect(screen.getByText(/15s left/)).toBeTruthy();
    // Type the first 20 characters of the (random) passage correctly.
    const first = document.querySelectorAll(".ae-typing-ch");
    const text = Array.from(first, (c) => c.textContent ?? "").join("");
    fireEvent.change(input, { target: { value: text.slice(0, 20) } });
    expect(screen.queryByText("Time's up!")).toBeNull();
    act(() => {
      vi.advanceTimersByTime(14_000);
    });
    expect(screen.queryByText("Time's up!")).toBeNull();
    act(() => {
      vi.advanceTimersByTime(1_100);
    });
    expect(screen.getByText("Time's up!")).toBeTruthy();
    expect(screen.getByText("New best!")).toBeTruthy();
    expect(screen.getByText("Accuracy").nextSibling?.textContent).toBe("100%");
    expect(Number(localStorage.getItem("ae:typing-best-wpm"))).toBeGreaterThan(
      0,
    );
  });

  it("ignores keys after the time is up and Enter starts a new test", () => {
    const input = startTimed();
    fireEvent.change(input, { target: { value: "a" } });
    act(() => {
      vi.advanceTimersByTime(15_100);
    });
    expect(screen.getByText("Time's up!")).toBeTruthy();
    fireEvent.keyDown(input, { key: "Enter", code: "Enter" });
    expect(screen.queryByText("Time's up!")).toBeNull();
    expect(screen.getByText(/15s left/)).toBeTruthy();
  });

  it("remembers the chosen timer length", () => {
    startTimed();
    expect(localStorage.getItem("ae:typing-seconds")).toBe("15");
  });
});
