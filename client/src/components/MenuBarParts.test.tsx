import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { SplitButton } from "./SplitButton";
import { SaveStatus } from "./SaveStatus";
import { DateStepper } from "./DateStepper";
import { ClearFilters, FilterSlot } from "./FilterSlot";
import { formatClock } from "../utils/dateFormat";

vi.mock("./Spinner", () => ({ Spinner: () => <span data-testid="spinner" /> }));

beforeEach(() => vi.clearAllMocks());

describe("SplitButton", () => {
  const items = [{ id: "through", label: "Finish through a date…", onSelect: vi.fn() }];

  it("runs the main action from the main button and opens the options from the chevron", () => {
    const onClick = vi.fn();
    render(<SplitButton label="Finish day" onClick={onClick} items={items} menuLabel="Finish options" />);
    fireEvent.click(screen.getByRole("button", { name: "Finish day" }));
    expect(onClick).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("menu")).toBeNull();

    const chevron = screen.getByRole("button", { name: "Finish day: more options" });
    expect(chevron.getAttribute("aria-haspopup")).toBe("menu");
    fireEvent.click(chevron);
    expect(screen.getByRole("menu", { name: "Finish options" })).toBeTruthy();
    expect(chevron.getAttribute("aria-expanded")).toBe("true");
  });

  it("choosing an option runs it, closes the menu and returns focus to the chevron", () => {
    render(<SplitButton label="Finish day" onClick={vi.fn()} items={items} menuLabel="Finish options" />);
    const chevron = screen.getByRole("button", { name: "Finish day: more options" });
    fireEvent.click(chevron);
    fireEvent.click(screen.getByRole("menuitem", { name: /Finish through/ }));
    expect(items[0].onSelect).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("menu")).toBeNull();
    expect(document.activeElement).toBe(chevron);
  });

  it("ArrowDown on the chevron opens it and Escape closes it, back on the chevron", () => {
    render(<SplitButton label="Finish day" onClick={vi.fn()} items={items} menuLabel="Finish options" />);
    const chevron = screen.getByRole("button", { name: "Finish day: more options" });
    fireEvent.keyDown(chevron, { key: "ArrowDown" });
    expect(screen.getByRole("menu")).toBeTruthy();
    fireEvent.keyDown(screen.getByRole("menu"), { key: "Escape" });
    expect(screen.queryByRole("menu")).toBeNull();
    expect(document.activeElement).toBe(chevron);
  });

  it("when unavailable, stays focusable, does nothing, and says why in both the tooltip and the accessibility tree", () => {
    const onClick = vi.fn();
    render(<SplitButton label="Finish day" onClick={onClick} disabledReason="Save or discard your changes first" items={items} menuLabel="Finish options" />);
    const main = screen.getByRole("button", { name: "Finish day" });
    expect(main.getAttribute("aria-disabled")).toBe("true");
    expect(main.getAttribute("title")).toBe("Save or discard your changes first");
    expect(document.getElementById(main.getAttribute("aria-describedby")!)?.textContent).toBe("Save or discard your changes first");
    fireEvent.click(main);
    expect(onClick).not.toHaveBeenCalled();
  });

  it("has no chevron when there is nothing to put in it", () => {
    render(<SplitButton label="Finish pending days" onClick={vi.fn()} items={[]} menuLabel="x" />);
    expect(screen.queryByRole("button", { name: /more options/ })).toBeNull();
  });
});

describe("SaveStatus", () => {
  it("shows nothing before the first save, but keeps a live region ready to announce it", () => {
    render(<SaveStatus state="idle" />);
    const region = screen.getByRole("status");
    expect(region.textContent).toBe("");
    expect(region.getAttribute("aria-live")).toBe("polite");
  });

  it("says Saving… with a spinner", () => {
    render(<SaveStatus state="saving" />);
    expect(screen.getByRole("status").textContent).toContain("Saving…");
    expect(screen.getByTestId("spinner")).toBeTruthy();
  });

  it("says when it saved, as a 24-hour clock, with a check", () => {
    const savedAt = new Date(2026, 9, 16, 21, 42).getTime();
    render(<SaveStatus state="saved" savedAt={savedAt} />);
    const region = screen.getByRole("status");
    expect(region.textContent).toContain("Saved 21:42");
    expect(region.querySelector("svg")).not.toBeNull();
  });

  it("says Failed with a warning icon and a retry button, so it is not only red", () => {
    const onRetry = vi.fn();
    render(<SaveStatus state="failed" onRetry={onRetry} />);
    const region = screen.getByRole("status");
    expect(region.textContent).toContain("Failed –");
    expect(region.querySelector("svg")).not.toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "retry" }));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });
});

describe("formatClock", () => {
  it("is a 24-hour clock with leading zeros", () => {
    expect(formatClock(new Date(2026, 9, 16, 7, 5).getTime())).toBe("07:05");
    expect(formatClock(new Date(2026, 9, 16, 23, 59).getTime())).toBe("23:59");
    expect(formatClock(new Date(2026, 9, 16, 0, 0).getTime())).toBe("00:00");
  });
});

describe("DateStepper", () => {
  it("steps a day at a time in either direction", () => {
    const onChange = vi.fn();
    render(<DateStepper value="2026-10-17" onChange={onChange} todayValue="2026-10-20" />);
    fireEvent.click(screen.getByRole("button", { name: "Previous day" }));
    expect(onChange).toHaveBeenLastCalledWith("2026-10-16");
    fireEvent.click(screen.getByRole("button", { name: "Next day" }));
    expect(onChange).toHaveBeenLastCalledWith("2026-10-18");
  });

  it("steps across a month boundary", () => {
    const onChange = vi.fn();
    render(<DateStepper value="2026-10-01" onChange={onChange} todayValue="2026-10-20" />);
    fireEvent.click(screen.getByRole("button", { name: "Previous day" }));
    expect(onChange).toHaveBeenLastCalledWith("2026-09-30");
  });

  it("Today jumps to the business day", () => {
    const onChange = vi.fn();
    render(<DateStepper value="2026-10-17" onChange={onChange} todayValue="2026-10-20" />);
    const today = screen.getByRole("button", { name: "Today" });
    expect(today.getAttribute("aria-disabled")).toBeNull();
    fireEvent.click(today);
    expect(onChange).toHaveBeenCalledWith("2026-10-20");
  });

  it("Today stays visible but unavailable when already there, and explains why", () => {
    const onChange = vi.fn();
    render(<DateStepper value="2026-10-20" onChange={onChange} todayValue="2026-10-20" />);
    const today = screen.getByRole("button", { name: "Today" });
    expect(today.getAttribute("aria-disabled")).toBe("true");
    expect(today.getAttribute("title")).toBe("Already on today");
    fireEvent.click(today);
    expect(onChange).not.toHaveBeenCalled();
  });
});

describe("FilterSlot and ClearFilters", () => {
  it("marks an active filter with a dot AND words, and nothing when it is off", () => {
    const { container, rerender } = render(
      <FilterSlot active label="Category">
        <button type="button">All categories</button>
      </FilterSlot>,
    );
    expect(container.querySelector(".ae-filter--active")).not.toBeNull();
    expect(container.querySelector(".ae-filter-dot")).not.toBeNull();
    expect(screen.getByText("Category filter is on")).toBeTruthy();

    rerender(
      <FilterSlot active={false} label="Category">
        <button type="button">All categories</button>
      </FilterSlot>,
    );
    expect(container.querySelector(".ae-filter--active")).toBeNull();
    expect(container.querySelector(".ae-filter-dot")).toBeNull();
    expect(screen.queryByText("Category filter is on")).toBeNull();
  });

  it("shows Clear filters only while something is filtered, says how many, and clears them", () => {
    const onClear = vi.fn();
    const { rerender } = render(<ClearFilters count={0} onClear={onClear} />);
    expect(screen.queryByRole("button", { name: /Clear filters/ })).toBeNull();

    rerender(<ClearFilters count={2} onClear={onClear} />);
    const button = screen.getByRole("button", { name: /Clear filters/ });
    expect(button.getAttribute("title")).toBe("Clear 2 active filters");
    fireEvent.click(button);
    expect(onClear).toHaveBeenCalledTimes(1);

    rerender(<ClearFilters count={1} onClear={onClear} />);
    expect(screen.getByRole("button", { name: /Clear filters/ }).getAttribute("title")).toBe("Clear 1 active filter");
  });
});
