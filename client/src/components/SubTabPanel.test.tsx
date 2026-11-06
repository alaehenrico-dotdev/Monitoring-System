import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { SubTabPanel } from "./SubTabPanel";

// jsdom lays nothing out, so the boxes the outline is measured from are supplied here: a 600 x 300 frame whose
// top is at 40, a strip ending there, and a current tab 110 wide - the same numbers as utils/subTabOutline.test.
const rect = (left: number, top: number, right: number, bottom: number) =>
  ({ left, top, right, bottom, width: right - left, height: bottom - top, x: left, y: top, toJSON: () => ({}) }) as DOMRect;

function layout(this: Element): DOMRect {
  if (this.classList.contains("ae-subtab-panel")) return rect(0, 40, 600, 340);
  if (this.classList.contains("ae-subtabs--framed")) return rect(0, 0, 600, 40);
  if (this.getAttribute("aria-selected") === "true") return this.textContent === "B" ? rect(130, 7, 230, 40) : rect(10, 7, 120, 40);
  return rect(0, 0, 0, 0);
}

function setReducedMotion(reduce: boolean) {
  window.matchMedia = ((query: string) => ({ matches: reduce && query.includes("reduce"), media: query, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {}, onchange: null, dispatchEvent: () => false })) as unknown as typeof window.matchMedia;
}

const page = (current: "A" | "B", framed = true) => (
  <div>
    <div className={framed ? "ae-subtabs ae-subtabs--framed" : "ae-subtabs"} role="tablist">
      <button role="tab" aria-selected={current === "A"}>A</button>
      <button role="tab" aria-selected={current === "B"}>B</button>
    </div>
    <SubTabPanel label={current}>
      <p>content {current}</p>
    </SubTabPanel>
  </div>
);

const path = () => document.querySelector(".ae-subtab-outline path")!.getAttribute("d")!;
const OPEN_AT_A = "M0.5 296V3A3.5 3.5 0 0 1 4 -0.5H7A3.5 3.5 0 0 0 10.5 -4V-29A3.5 3.5 0 0 1 14 -32.5H116A3.5 3.5 0 0 1 119.5 -29V-4A3.5 3.5 0 0 0 123 -0.5H596A3.5 3.5 0 0 1 599.5 3V296A3.5 3.5 0 0 1 596 299.5H4A3.5 3.5 0 0 1 0.5 296Z";

beforeEach(() => {
  vi.spyOn(Element.prototype, "getBoundingClientRect").mockImplementation(layout);
  Object.defineProperty(window, "devicePixelRatio", { value: 1, configurable: true });
  setReducedMotion(false);
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe("SubTabPanel", () => {
  it("is the tab panel, with its content, labelled by the current tab", () => {
    render(page("A"));
    const panel = screen.getByRole("tabpanel", { name: "A" });
    expect(panel).toHaveTextContent("content A");
  });

  it("draws the outline measured from the real strip, tab and frame, hidden from assistive technology", () => {
    render(page("A"));
    const svg = document.querySelector(".ae-subtab-outline")!;
    expect(svg.getAttribute("aria-hidden")).toBe("true");
    expect(path()).toBe(OPEN_AT_A);
  });

  it("draws nothing beside a tab strip that is not the framed kind (a status filter in a toolbar row)", () => {
    render(page("A", false));
    expect(document.querySelector(".ae-subtab-outline")).toBeNull();
    expect(screen.getByRole("tabpanel")).toHaveTextContent("content A");
  });

  it("moves the opening to another tab at once when reduced motion is asked for, and does not animate the content", () => {
    setReducedMotion(true);
    const animate = vi.fn();
    Element.prototype.animate = animate;
    const { rerender } = render(page("A"));
    rerender(page("B"));
    expect(path()).toContain("H127A3.5 3.5 0 0 0 130.5 -4"); // the left foot of the tab at 130 - already there
    expect(animate).not.toHaveBeenCalled();
  });

  it("glides the opening from the old tab to the new one, a frame at a time, and ends exactly on it", () => {
    vi.useFakeTimers({ toFake: ["requestAnimationFrame", "cancelAnimationFrame"] });
    const { rerender } = render(page("A"));
    expect(path()).toBe(OPEN_AT_A);
    rerender(page("B"));
    // Part-way: the left foot starts somewhere between the old tab (x = 10.5) and the new (130.5).
    vi.advanceTimersByTime(100);
    const mid = path();
    const footX = (d: string) => Number(d.match(/H([\d.]+)A3\.5 3\.5 0 0 0 ([\d.]+) -4/)?.[2]);
    expect(footX(mid)).toBeGreaterThan(10.5);
    expect(footX(mid)).toBeLessThan(130.5);
    // Still one closed path, with all eight corners, all the way.
    expect(mid.endsWith("Z")).toBe(true);
    expect((mid.match(/A/g) ?? []).length).toBe(8);
    // Done: exactly where a plain measurement puts it.
    vi.advanceTimersByTime(400);
    expect(footX(path())).toBe(130.5);
    expect(path()).toContain("H226A3.5 3.5 0 0 1 229.5 -29");
  });

  it("is not cut short by the resize notifications the tab change itself causes", () => {
    // Choosing a tab changes the label weights, which nudges the tabs' widths and makes the browser report a resize.
    vi.useFakeTimers({ toFake: ["requestAnimationFrame", "cancelAnimationFrame"] });
    const { rerender } = render(page("A"));
    rerender(page("B"));
    vi.advanceTimersByTime(100);
    const footX = (d: string) => Number(d.match(/A3\.5 3\.5 0 0 0 ([\d.]+) -4/)?.[1]);
    const before = footX(path());
    window.dispatchEvent(new Event("resize")); // mid-glide
    expect(footX(path())).toBe(before); // it did not jump to the end
    expect(before).toBeGreaterThan(10.5);
    expect(before).toBeLessThan(130.5);
    vi.advanceTimersByTime(400);
    expect(footX(path())).toBe(130.5);
    // After the glide a resize moves the outline at once again.
    window.dispatchEvent(new Event("resize"));
    expect(footX(path())).toBe(130.5);
  });

  it("carries on from where it had got to when another tab is chosen mid-glide, instead of jumping back", () => {
    vi.useFakeTimers({ toFake: ["requestAnimationFrame", "cancelAnimationFrame"] });
    const { rerender } = render(page("A"));
    rerender(page("B"));
    vi.advanceTimersByTime(100);
    const footX = (d: string) => Number(d.match(/A3\.5 3\.5 0 0 0 ([\d.]+) -4/)?.[1]);
    const midway = footX(path());
    rerender(page("A")); // back to A, before B has been reached
    vi.advanceTimersByTime(20);
    const next = footX(path());
    // It heads back towards A (10.5) from where it was; it never snaps to the old start or the old target first.
    expect(next).toBeLessThanOrEqual(midway + 0.5);
    expect(next).toBeGreaterThan(10.5);
    vi.advanceTimersByTime(400);
    expect(footX(path())).toBe(10.5);
  });

  it("settles the content in when another tab is chosen, but not on the first showing", () => {
    const animate = vi.fn();
    Element.prototype.animate = animate;
    const { rerender } = render(page("A"));
    expect(animate).not.toHaveBeenCalled();
    rerender(page("B"));
    expect(animate).toHaveBeenCalledTimes(1);
    const [frames, options] = animate.mock.calls[0];
    expect(frames[0]).toMatchObject({ opacity: 0 });
    expect(frames[1]).toMatchObject({ opacity: 1 });
    expect(options.duration).toBeLessThanOrEqual(250); // quick: it must never feel like waiting
  });
});
