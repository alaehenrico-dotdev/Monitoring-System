import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render } from "@testing-library/react";
import type { ReactNode } from "react";
import { join } from "node:path";
import { readAllCss } from "../test-utils/css";

vi.mock("../hooks/useReadOnlyPhone", () => ({ useReadOnlyPhone: () => false }));

import { ThemeProvider, useChartPrefs, useTheme } from "../context/ThemeContext";
import { FlowLineChart, type FlowPoint, type FlowSeries } from "./FlowLineChart";
import { act, renderHook } from "@testing-library/react";

const SERIES: FlowSeries[] = [
  { key: "a", label: "A", color: "red" },
  { key: "b", label: "B", color: "blue" },
];
const POINTS: FlowPoint[] = [1, 2, 3].map((n) => ({ key: `d${n}`, label: `D${n}`, title: `Day ${n}`, ariaLabel: `Day ${n}`, values: { a: n * 10, b: n * 5 } }));

const wrapper = ({ children }: { children: ReactNode }) => <ThemeProvider>{children}</ThemeProvider>;
const chart = () => render(<FlowLineChart points={POINTS} series={SERIES} />, { wrapper });

beforeEach(() => localStorage.clear());
afterEach(() => localStorage.clear());

describe("chart preferences", () => {
  it("default to the classic line chart, also outside a ThemeProvider", () => {
    expect(renderHook(() => useChartPrefs()).result.current).toEqual({ chartType: "line", chartLook: "classic" });
  });

  it("are remembered per browser, and a stale saved value falls back", () => {
    const { result } = renderHook(() => useTheme(), { wrapper });
    act(() => {
      result.current.setChartType("bar");
      result.current.setChartLook("bold");
    });
    expect(localStorage.getItem("ae-chart-type")).toBe("bar");
    expect(localStorage.getItem("ae-chart-look")).toBe("bold");
    localStorage.setItem("ae-chart-type", "pie");
    expect(renderHook(() => useTheme(), { wrapper }).result.current.chartType).toBe("line");
  });
});

describe("FlowLineChart drawing", () => {
  it("draws one curve per series and dots by default", () => {
    const { container } = chart();
    expect(container.querySelectorAll(".ae-fl-line")).toHaveLength(2);
    expect(container.querySelector(".ae-fl-area")).toBeNull();
    expect(container.querySelector(".ae-fl-bars")).toBeNull();
    expect(container.querySelectorAll(".ae-fl-dot--sm")).toHaveLength(6);
    expect(container.querySelector(".ae-fl-chart")?.getAttribute("data-look")).toBe("classic");
  });

  it("draws grouped bars, one per series per day, in bar mode", () => {
    localStorage.setItem("ae-chart-type", "bar");
    const { container } = chart();
    expect(container.querySelectorAll(".ae-fl-bargroup")).toHaveLength(3);
    expect(container.querySelectorAll(".ae-fl-bar")).toHaveLength(6);
    expect(container.querySelector(".ae-fl-line")).toBeNull();
    expect(container.querySelector(".ae-fl-dot--sm")).toBeNull();
  });

  it("piles each day into a stack of identical blocks in stacked mode, taller for a bigger day", () => {
    localStorage.setItem("ae-chart-type", "stack");
    const { container } = chart();
    const groups = [...container.querySelectorAll(".ae-fl-bargroup--stack")];
    expect(groups).toHaveLength(3);
    const counts = groups.map((g) => g.querySelectorAll(".ae-fl-bar").length);
    expect(counts[0]).toBeLessThan(counts[1]);
    expect(counts[1]).toBeLessThan(counts[2]);
    expect(Math.max(...counts)).toBeLessThanOrEqual(24);
    // Every block is the same size, whatever its series.
    expect(new Set([...container.querySelectorAll(".ae-fl-bar")].map((n) => (n as HTMLElement).style.height)).size).toBe(1);
    expect(container.querySelector(".ae-fl-line")).toBeNull();
    // The biggest day totals 30 + 15 = 45, so the y axis must reach past it (a grouped chart would stop near 30).
    const top = Math.max(...[...container.querySelectorAll(".ae-fl-yaxis span")].map((n) => Number(n.textContent)));
    expect(top).toBeGreaterThanOrEqual(45);
  });

  it("fills under each curve in area mode and carries the look for the stylesheet", () => {
    localStorage.setItem("ae-chart-type", "area");
    localStorage.setItem("ae-chart-look", "minimal");
    const { container } = chart();
    expect(container.querySelectorAll(".ae-fl-area")).toHaveLength(2);
    expect(container.querySelectorAll(".ae-fl-line")).toHaveLength(2);
    expect(container.querySelector(".ae-fl-chart")?.getAttribute("data-look")).toBe("minimal");
  });

  it("keeps every day focusable with its readable label in every type", () => {
    for (const type of ["line", "bar", "stack", "area"]) {
      localStorage.setItem("ae-chart-type", type);
      const { container, unmount } = chart();
      expect([...container.querySelectorAll(".ae-fl-col")].map((c) => c.getAttribute("aria-label"))).toEqual(["Day 1", "Day 2", "Day 3"]);
      unmount();
    }
  });
});

describe("bar layout (a jsdom test cannot measure it, so the stylesheet is checked)", () => {
  it("never pads a day's group by a percentage, which is taken from the whole plot and left the bars 0px wide", () => {
    const css = readAllCss(join(__dirname, "..", "index.css"));
    for (const m of css.matchAll(/\.ae-fl-bargroup[^{]*\{([^}]*)\}/g)) expect(m[1]).not.toMatch(/padding[^;]*%/);
  });
});

describe("load animation", () => {
  it("only plays for people who have not asked for less motion", () => {
    let css = readAllCss(join(__dirname, "..", "index.css"));
    const OPEN = "@media (prefers-reduced-motion: no-preference) {";
    let motion = "";
    // Take every no-preference block out of the stylesheet; what is left must declare no chart animation.
    for (let at = css.indexOf(OPEN); at >= 0; at = css.indexOf(OPEN)) {
      const end = css.indexOf("\n}\n", at) + 3;
      motion += css.slice(at, end);
      css = css.slice(0, at) + css.slice(end);
    }
    for (const sel of [".ae-fl-lines", ".ae-fl-dot--sm", ".ae-fl-bargroup--stack .ae-fl-bar", ".ae-fl-today", ".ae-fl-flash", ".ae-fl-missing"]) expect(motion).toContain(sel);
    expect(css).not.toMatch(/\.ae-fl-[^{]*\{[^}]*animation:/);
  });

  it("replays when the chart kind or its days change, not on a refresh of the same days", () => {
    localStorage.setItem("ae-chart-type", "bar");
    const first = chart();
    const plot = first.container.querySelector(".ae-fl-plot");
    first.rerender(<FlowLineChart points={POINTS.map((p) => ({ ...p, values: { a: 1, b: 2 } }))} series={SERIES} />);
    expect(first.container.querySelector(".ae-fl-plot")).toBe(plot);
    first.rerender(<FlowLineChart points={POINTS.slice(1)} series={SERIES} />);
    expect(first.container.querySelector(".ae-fl-plot")).not.toBe(plot);
  });
});

describe("a day still being entered", () => {
  it("marks today with a band, a live dot on its label and an in-progress note", () => {
    const points = POINTS.map((p, i) => ({ ...p, current: i === 2 }));
    const { container } = render(<FlowLineChart points={points} series={SERIES} />, { wrapper });
    expect(container.querySelectorAll(".ae-fl-today")).toHaveLength(1);
    expect(container.querySelector(".ae-fl-xlabel--current")?.className).toContain("ae-fl-xlabel--live");
  });

  it("shows no band when no day is current", () => {
    const { container } = chart();
    expect(container.querySelector(".ae-fl-today")).toBeNull();
  });

  it("does not flash a day on the first draw", () => {
    const { container } = chart();
    expect(container.querySelector(".ae-fl-flash")).toBeNull();
    expect(container.querySelector(".ae-fl-chart")?.getAttribute("data-settled")).toBeNull();
  });
});

describe("days with nothing entered", () => {
  const withGap = POINTS.map((p, i) => (i === 1 ? { ...p, values: { a: null, b: null } } : p));

  it("blink on the days that have no entries, and only those", () => {
    const { container } = render(<FlowLineChart points={withGap} series={SERIES} />, { wrapper });
    const bands = container.querySelectorAll(".ae-fl-missing");
    expect(bands).toHaveLength(1);
    expect((bands[0] as HTMLElement).style.left).toBe(`${(1 / 3) * 100}%`);
  });

  it("do not blink at all when the whole period is empty, nor when every day has data", () => {
    const empty = POINTS.map((p) => ({ ...p, values: { a: null, b: null } }));
    expect(render(<FlowLineChart points={empty} series={SERIES} />, { wrapper }).container.querySelector(".ae-fl-missing")).toBeNull();
    expect(chart().container.querySelector(".ae-fl-missing")).toBeNull();
  });

  it("show in every chart type", () => {
    for (const type of ["line", "bar", "stack", "area"]) {
      localStorage.setItem("ae-chart-type", type);
      const { container, unmount } = render(<FlowLineChart points={withGap} series={SERIES} />, { wrapper });
      expect(container.querySelectorAll(".ae-fl-missing")).toHaveLength(1);
      unmount();
    }
  });
});
