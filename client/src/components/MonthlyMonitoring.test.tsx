import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import type { MonthlyOverviewEntry } from "../api/dashboard";
import { MonthlyMonitoring } from "./MonthlyMonitoring";

const getMonthlyOverview = vi.fn<(year: number) => Promise<MonthlyOverviewEntry[]>>();
vi.mock("../api/dashboard", () => ({
  getMonthlyOverview: (year: number) => getMonthlyOverview(year),
}));

const month = (m: number, online: number | null, offline: number | null, flags: number | null): MonthlyOverviewEntry => ({
  month: m,
  onlineRemainingStock: online,
  offlineRemainingStock: offline,
  totalRemainingStock: online === null || offline === null ? null : online + offline,
  varianceFlags: flags,
  snapshotDate: online === null ? null : `2026-${String(m).padStart(2, "0")}-28`,
});

const YEAR = [
  month(1, 12_000, 3_400, 0),
  month(2, 37_400, 9_000, 2),
  ...Array.from({ length: 10 }, (_, i) => month(i + 3, null, null, null)),
];

beforeEach(() => {
  getMonthlyOverview.mockReset();
  getMonthlyOverview.mockResolvedValue(YEAR);
});

async function renderChart() {
  render(<MonthlyMonitoring />);
  return screen.findByRole("group", { name: "Chart view" });
}

describe("MonthlyMonitoring", () => {
  it("draws a round-number y-axis above the data's maximum", async () => {
    await renderChart();
    const ticks = Array.from(document.querySelectorAll(".ae-mm-yaxis span")).map((s) => s.textContent);
    expect(ticks).toEqual(["0", "20K", "40K", "60K"]);
  });

  it("draws the total as a bar and each pool as a line on the same scale", async () => {
    await renderChart();
    const feb = screen.getAllByRole("img")[1];
    expect(parseFloat(feb.querySelector<HTMLElement>(".ae-mm-bar")!.style.height)).toBeCloseTo(77.33, 1); // 46,400 of 60,000
    expect(screen.queryByText(/A line needs two consecutive months/)).toBeNull();
    const point = (series: string, n: number) => {
      const pts = document.querySelector(`.ae-mm-line--${series}`)!.getAttribute("points")!.split(" ");
      return pts[n].split(",").map(Number);
    };
    const [x, y] = point("online", 1);
    expect(x).toBeCloseTo(12.5); // February's centre: 1.5 of 12 months
    expect(y).toBeCloseTo(100 - (37_400 / 60_000) * 100); // 37,400 of 60,000, measured from the top
    expect(point("offline", 1)[1]).toBeCloseTo(100 - (9_000 / 60_000) * 100);
  });

  it("breaks the line at a month with no entries instead of dropping it to zero", async () => {
    getMonthlyOverview.mockResolvedValue([
      month(1, 100, 50, 0),
      month(2, null, null, null),
      month(3, 120, 60, 0),
      ...Array.from({ length: 9 }, (_, i) => month(i + 4, null, null, null)),
    ]);
    await renderChart();
    expect(document.querySelectorAll(".ae-mm-line")).toHaveLength(0);
    // The two lone months can't be a line, so each keeps a dot.
    expect(document.querySelectorAll(".ae-mm-dot")).toHaveLength(4);
    expect(screen.getByText(/A line needs two consecutive months/)).toBeInTheDocument();
  });

  it("shows every series, the total and the flag count when a month is hovered", async () => {
    await renderChart();
    expect(document.querySelector(".ae-mm-tip")).toBeNull();
    fireEvent.pointerEnter(screen.getAllByRole("img")[1]);
    const tip = document.querySelector<HTMLElement>(".ae-mm-tip")!;
    expect(within(tip).getByText("37,400")).toBeInTheDocument();
    expect(within(tip).getByText("9,000")).toBeInTheDocument();
    expect(within(tip).getByText("46,400")).toBeInTheDocument();
    expect(within(tip).getByText("2 variance flags")).toBeInTheDocument();
    fireEvent.pointerLeave(document.querySelector(".ae-mm-chart")!);
    expect(document.querySelector(".ae-mm-tip")).toBeNull();
  });

  it("opens the same readout on keyboard focus, and closes it on blur", async () => {
    await renderChart();
    const jan = screen.getAllByRole("img")[0];
    fireEvent.focus(jan);
    expect(within(document.querySelector<HTMLElement>(".ae-mm-tip")!).getByText("No variance flags")).toBeInTheDocument();
    fireEvent.blur(jan);
    expect(document.querySelector(".ae-mm-tip")).toBeNull();
  });

  it("says so, rather than drawing a zero, for a month with no entries", async () => {
    await renderChart();
    const mar = screen.getAllByRole("img")[2];
    expect(mar).toHaveAccessibleName(`March ${new Date().getFullYear()} — No entries recorded yet`);
    expect(mar.querySelector(".ae-mm-bar")).toBeNull();
    fireEvent.pointerEnter(mar);
    expect(screen.getByText("No entries recorded yet")).toBeInTheDocument();
  });

  it("offers the same figures as a table", async () => {
    await renderChart();
    fireEvent.click(screen.getByRole("button", { name: "Table" }));
    expect(document.querySelector(".ae-mm-chart")).toBeNull();
    const rows = screen.getAllByRole("row");
    expect(rows).toHaveLength(13); // header + 12 months
    expect(within(rows[2]).getByText("46,400")).toBeInTheDocument();
    expect(within(rows[3]).getAllByText("—")).toHaveLength(4); // every figure for a month with no entries
  });
});
