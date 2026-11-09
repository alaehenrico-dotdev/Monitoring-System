import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ReactNode } from "react";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { DailyOutPage } from "./DailyOutPage";
import type { DailyOutEntry } from "../api/dailyOut";

const api = vi.hoisted(() => ({ getDailyOut: vi.fn() }));
vi.mock("../api/dailyOut", () => api);
vi.mock("../components/PageHeader", () => ({
  PageHeader: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));
vi.mock("../context/RealtimeContext", () => ({ useRealtimeVersion: () => 0 }));
vi.mock("../context/AuthContext", () => ({ useAuth: () => ({ user: { id: 1, role: "SUPERVISOR_ADMIN" } }) }));
vi.mock("../api/reportHistory", () => ({ recordReportHistory: vi.fn().mockResolvedValue({}) }));

const day = (date: string, onlineOut: number | null, offlineOut: number | null, onlineRts: number | null = null, offlineBackloads: number | null = null): DailyOutEntry => ({
  date,
  onlineOut,
  onlineRts,
  offlineOut,
  offlineBackloads,
  totalOut: onlineOut === null && offlineOut === null ? null : (onlineOut ?? 0) + (offlineOut ?? 0),
});

beforeEach(() => {
  vi.clearAllMocks();
  api.getDailyOut.mockImplementation(async (from: string) => {
    const [y, m, d] = from.split("-").map(Number);
    return Array.from({ length: 14 }, (_, i) => {
      const dt = new Date(y, m - 1, d + i);
      const iso = `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, "0")}-${String(dt.getDate()).padStart(2, "0")}`;
      return i === 3 ? day(iso, null, null) : day(iso, 100 + i, 40 + i);
    });
  });
});

const open = () =>
  render(
    <MemoryRouter>
      <DailyOutPage />
    </MemoryRouter>,
  );

const showChart = async () => {
  await screen.findByText(/Over 13 days/);
  fireEvent.click(screen.getByRole("button", { name: "Chart" }));
};

describe("DailyOutPage", () => {
  it("opens on the table, with the chart one click away", async () => {
    open();
    await screen.findByText(/Over 13 days/);
    expect(screen.getAllByRole("row")).toHaveLength(2 + 14 + 1);
    expect(document.querySelector(".ae-fl-chart")).toBeNull();
    expect(screen.getByRole("button", { name: "Table" })).toHaveAttribute("aria-pressed", "true");
    fireEvent.click(screen.getByRole("button", { name: "Chart" }));
    expect(document.querySelector(".ae-fl-chart")).not.toBeNull();
  });

  it("uses the same date stepper as the other pages, ending the window on the chosen day", async () => {
    open();
    await screen.findByText(/Over 13 days/);
    const [from0, to0] = api.getDailyOut.mock.calls[0];
    fireEvent.click(screen.getByRole("button", { name: "Previous day" }));
    await screen.findByText(/Over 13 days/);
    const [from1, to1] = api.getDailyOut.mock.calls.at(-1)!;
    const shift = (a: string, b: string) => (new Date(a).getTime() - new Date(b).getTime()) / 86_400_000;
    expect(shift(to0, to1)).toBe(1);
    expect(shift(from0, from1)).toBe(1);
    expect(screen.getByRole("button", { name: "Today" })).not.toHaveAttribute("aria-disabled");
  });

  it("asks for the last 14 days, oldest first", async () => {
    open();
    await screen.findByText(/Over 13 days/);
    const [from, to] = api.getDailyOut.mock.calls[0];
    expect(from <= to).toBe(true);
    expect((new Date(to).getTime() - new Date(from).getTime()) / 86_400_000).toBe(13);
  });

  it("plots one column per day, and a day nobody encoded reads as no entries", async () => {
    open();
    await showChart();
    expect(screen.getAllByRole("img")).toHaveLength(14);
    expect(screen.getAllByRole("img")[3]).toHaveAccessibleName(/No entries recorded/);
  });

  it("opens a readout with Online, Offline and combined out for the day", async () => {
    open();
    await showChart();
    fireEvent.pointerEnter(screen.getAllByRole("img")[0]);
    const tip = document.querySelector<HTMLElement>(".ae-fl-tip")!;
    expect(within(tip).getByText("Combined out")).toBeInTheDocument();
    expect(within(tip).getByText("Online out")).toBeInTheDocument();
    expect(within(tip).getByText("Offline out")).toBeInTheDocument();
    expect(within(tip).getByText("140")).toBeInTheDocument(); // 100 + 40
  });

  it("offers the same days as a table with a total row", async () => {
    open();
    await screen.findByText(/Over 13 days/);
    const rows = screen.getAllByRole("row");
    expect(rows).toHaveLength(2 + 14 + 1); // two header rows, 14 days, total
    expect(within(rows[rows.length - 1]).getByText("Total")).toBeInTheDocument();
    expect(within(rows[5]).getAllByText("—")).toHaveLength(5); // the empty day: every figure
  });

  it("groups Online (Out, RTS) and Offline (Out, Backloads) under a two-row header", async () => {
    open();
    await screen.findByText(/Over 13 days/);
    const heads = screen.getAllByRole("columnheader").map((h) => h.textContent);
    expect(heads).toEqual(["Date", "Online", "Offline", "Combined", "Fulfillment", "RTS", "Out", "Backloads"]);
  });
});

describe("DailyOutPage against a server that sends no RTS or Backloads figures", () => {
  it("shows a dash, never NaN, in those columns", async () => {
    api.getDailyOut.mockImplementation(async () =>
      // The old server's shape: the new fields are absent altogether (not null).
      [{ date: "2026-10-01", onlineOut: 120, offlineOut: 80, totalOut: 200 }] as unknown as DailyOutEntry[],
    );
    open();
    await screen.findByText(/Over 1 day/);
    expect(document.body.textContent).not.toContain("NaN");
    const row = screen.getAllByRole("row").find((r) => r.textContent?.includes("120"))!;
    const cells = within(row).getAllByRole("cell").map((c) => c.textContent);
    // Date, Fulfillment, RTS, Out, Backloads, Combined
    expect(cells.slice(1)).toEqual(["120", "—", "80", "—", "200"]);
  });
});
