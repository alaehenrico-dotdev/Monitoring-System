import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { DateRangePicker } from "./DateRangePicker";
import { rangeLabels } from "../utils/calendar";

beforeEach(() => {
  Element.prototype.scrollIntoView = vi.fn();
});

function Harness({ initial = ["2026-10-01", ""], spy }: { initial?: string[]; spy: (f: string, t: string) => void }) {
  const [range, setRange] = useState(initial);
  return (
    <DateRangePicker
      aria-label="Date range"
      from={range[0]}
      to={range[1]}
      onChange={(f, t) => {
        spy(f, t);
        setRange([f, t]);
      }}
    />
  );
}

const trigger = () => screen.getByRole("button", { name: /^Date range:/ });
const day = (label: string) => screen.getByRole("button", { name: label });

describe("DateRangePicker", () => {
  it("is one field showing the whole range", () => {
    render(<Harness initial={["2026-10-01", "2026-10-09"]} spy={() => {}} />);
    expect(trigger().textContent).toContain("Oct 1 – Oct 9, 2026");
  });

  it("takes a start then an end click and closes", async () => {
    const spy = vi.fn();
    render(<Harness spy={spy} />);
    fireEvent.click(trigger());

    fireEvent.click(await screen.findByRole("button", { name: "October 5, 2026" }));
    expect(spy).toHaveBeenLastCalledWith("2026-10-05", "2026-10-05");
    expect(screen.getByRole("dialog")).toBeTruthy();

    fireEvent.click(day("October 9, 2026"));
    expect(spy).toHaveBeenLastCalledWith("2026-10-05", "2026-10-09");
    expect(spy).toHaveBeenCalledTimes(2);
  });

  it("orders the ends when the end is clicked first", async () => {
    const spy = vi.fn();
    render(<Harness spy={spy} />);
    fireEvent.click(trigger());

    fireEvent.click(await screen.findByRole("button", { name: "October 9, 2026" }));
    fireEvent.click(day("October 5, 2026"));

    expect(spy).toHaveBeenLastCalledWith("2026-10-05", "2026-10-09");
  });

  it("clears with Any date", async () => {
    const spy = vi.fn();
    render(<Harness initial={["2026-10-01", "2026-10-09"]} spy={spy} />);
    fireEvent.click(trigger());

    fireEvent.click(await screen.findByRole("button", { name: "Any date" }));

    expect(spy).toHaveBeenCalledWith("", "");
    expect(trigger().textContent).toContain("Any date");
  });
});

describe("rangeLabels", () => {
  it("covers open-ended and single-day ranges", () => {
    expect(rangeLabels("", "").long).toBe("Any date");
    expect(rangeLabels("2026-10-09", "2026-10-09").long).toBe("Oct 9, 2026");
    expect(rangeLabels("2026-10-09", "").long).toBe("From Oct 9, 2026");
    expect(rangeLabels("", "2026-10-09").long).toBe("Until Oct 9, 2026");
    expect(rangeLabels("2025-12-30", "2026-01-02").long).toBe("Dec 30, 2025 – Jan 2, 2026");
  });
});
