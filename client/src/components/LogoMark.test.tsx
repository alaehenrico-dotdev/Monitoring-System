import { afterEach, describe, expect, it, vi } from "vitest";
import { render } from "@testing-library/react";
import { LogoMark } from "./LogoMark";

// jsdom has no media playback or IntersectionObserver - stub just enough to
// observe whether the component asks the <video> to play or pause.
let trigger: (isIntersecting: boolean) => void = () => {};
class FakeObserver {
  constructor(cb: (entries: { isIntersecting: boolean }[]) => void) {
    trigger = (isIntersecting) => cb([{ isIntersecting }]);
  }
  observe() {}
  disconnect() {}
}

afterEach(() => {
  vi.unstubAllGlobals();
  Object.defineProperty(document, "hidden", { configurable: true, value: false });
});

describe("LogoMark playback", () => {
  it("pauses off-screen, resumes on-screen, and pauses while the tab is hidden", () => {
    vi.stubGlobal("IntersectionObserver", FakeObserver);
    const play = vi.spyOn(HTMLMediaElement.prototype, "play").mockResolvedValue();
    const pause = vi.spyOn(HTMLMediaElement.prototype, "pause").mockImplementation(() => {});

    const { container, unmount } = render(<LogoMark size={56} />);
    expect(container.querySelector("video")).not.toBeNull();

    trigger(false);
    expect(pause).toHaveBeenCalledTimes(1);

    trigger(true);
    expect(play).toHaveBeenCalledTimes(1);

    Object.defineProperty(document, "hidden", { configurable: true, value: true });
    document.dispatchEvent(new Event("visibilitychange"));
    expect(pause).toHaveBeenCalledTimes(2);

    Object.defineProperty(document, "hidden", { configurable: true, value: false });
    document.dispatchEvent(new Event("visibilitychange"));
    expect(play).toHaveBeenCalledTimes(2);

    unmount();
    document.dispatchEvent(new Event("visibilitychange"));
    expect(play).toHaveBeenCalledTimes(2);
  });

  it("still renders without IntersectionObserver", () => {
    vi.stubGlobal("IntersectionObserver", undefined);
    const { container } = render(<LogoMark />);
    expect(container.querySelector("video")).not.toBeNull();
  });
});
