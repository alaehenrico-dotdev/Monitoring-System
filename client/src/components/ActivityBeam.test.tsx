import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, render } from "@testing-library/react";
import { ActivityBeam } from "./ActivityBeam";
import { beginActivity, resetActivity, setConnecting, SHOW_AFTER_MS, SLOW_AFTER_MS } from "../utils/activity";

beforeEach(() => {
  vi.useFakeTimers();
  resetActivity();
});
afterEach(() => {
  resetActivity();
  vi.useRealTimers();
});

const advance = (ms: number) => act(() => void vi.advanceTimersByTime(ms));
const beam = (c: HTMLElement) => c.querySelector(".ae-seal-beam") as HTMLElement;

describe("ActivityBeam", () => {
  it("is idle (no beam) when the system is quiet", () => {
    const { container } = render(<ActivityBeam size={56} />);
    expect(beam(container)).toHaveClass("is-idle");
    expect(container.querySelector('[role="status"]')).toHaveTextContent("");
  });

  it("circles the seal while something is saving or loading, without announcing routine work", () => {
    const { container } = render(<ActivityBeam size={56} />);
    act(() => void beginActivity());
    advance(SHOW_AFTER_MS + 1);
    expect(beam(container)).toHaveClass("is-busy");
    expect(container.querySelector('[role="status"]')).toHaveTextContent("");
  });

  it("goes amber and says so for a slow connection", () => {
    const { container } = render(<ActivityBeam size={56} />);
    act(() => void beginActivity());
    advance(SLOW_AFTER_MS + 100);
    expect(beam(container)).toHaveClass("is-slow");
    expect(container.querySelector('[role="status"]')).toHaveTextContent("Slow connection - still working");
  });

  it("says it is reconnecting while the live connection is down", () => {
    const { container } = render(<ActivityBeam size={56} />);
    act(() => setConnecting(true));
    advance(SHOW_AFTER_MS + 1);
    expect(beam(container)).toHaveClass("is-connecting");
    expect(container.querySelector('[role="status"]')).toHaveTextContent("Reconnecting to the server");
  });

  it("takes the seal's size, and is hidden from assistive technology apart from that status line", () => {
    const { container } = render(<ActivityBeam size={32} />);
    expect(beam(container).style.getPropertyValue("--lp")).toBe("32px");
    expect(container.querySelector(".ae-logo-orbit")).toHaveAttribute("aria-hidden", "true");
  });
});
