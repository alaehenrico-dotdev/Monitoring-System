import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { VarianceDetails } from "./VarianceDetails";
import type { VarianceTrace } from "../api/manualCounts";

const api = vi.hoisted(() => ({ getVarianceTrace: vi.fn(), setCountRemarks: vi.fn() }));
vi.mock("../api/manualCounts", () => api);

const trace = (over: Partial<VarianceTrace> = {}): VarianceTrace => ({
  product: { id: 5, sku: "AFP007", name: "Soy Sauce 1L" },
  location: "ONLINE",
  entryDate: "2026-10-09",
  shift: "NIGHT",
  count: { manualCount: 100, systemRemainingStock: 105, variance: 5, remarks: null, countedBy: "Ana Cruz", countedAt: "2026-10-09T20:00:00.000Z", publishedAt: null },
  opening: { expected: 100, actual: 100, isBreak: false, source: "system" },
  entrySaved: true,
  encodedBy: "Ben Reyes",
  figures: [
    { label: "Opening stock", value: "100" },
    { label: "Production in", value: "20" },
    { label: "Fulfillment out", value: "15" },
  ],
  history: [
    { at: "2026-10-09T21:00:00.000Z", who: "Ben Reyes", what: "Entry", action: "UPDATE", summary: "Fulfillment out 10 → 15", auto: false, afterCount: true },
    { at: "2026-10-09T20:00:00.000Z", who: "Ana Cruz", what: "Count", action: "UPDATE", summary: "Manual count 90 → 100", auto: false, afterCount: false },
    { at: "2026-10-09T12:00:00.000Z", who: "Ana Cruz", what: "Entry", action: "UPDATE", summary: "Opening stock 90 → 100", auto: true, afterCount: false },
  ],
  ...over,
});

function open(locations: ("ONLINE" | "OFFLINE")[] = ["ONLINE"], canEdit = true) {
  render(
    <VarianceDetails productId={5} productName="Soy Sauce 1L" sku="AFP007" date="2026-10-09" shift="NIGHT" locations={locations} canEdit={canEdit} onClose={vi.fn()} />,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  api.getVarianceTrace.mockResolvedValue(trace());
});

describe("VarianceDetails", () => {
  it("shows the count, the counter and the variance", async () => {
    open();
    expect(await screen.findByText(/variance 5/)).toBeTruthy();
    expect(screen.getByText(/counted by/).textContent).toContain("Ana Cruz");
  });

  it("lists the movements and who last entered them", async () => {
    open();
    const movements = await screen.findByText(/Production in 20 · Fulfillment out 15/);
    expect(movements.textContent).toContain("last entered by Ben Reyes");
  });

  it("marks edits made after the count and attributes automatic ones to the system", async () => {
    open();
    expect(await screen.findByText("after the count")).toBeTruthy();
    expect(screen.getByText("Fulfillment out 10 → 15", { exact: false })).toBeTruthy();
    expect(screen.getByText("System")).toBeTruthy();
  });

  it("warns when the opening stock does not carry forward", async () => {
    api.getVarianceTrace.mockResolvedValue(trace({ opening: { expected: 130, actual: 100, isBreak: true, source: "count" } }));
    open();
    expect(await screen.findByText(/does not match what carries forward \(130 from the previous count\)/)).toBeTruthy();
  });

  it("saves remarks for a saved count", async () => {
    api.setCountRemarks.mockResolvedValue({ remarks: "Spoilage" });
    open();
    const box = await screen.findByPlaceholderText(/Spoilage, damaged/);

    fireEvent.change(box, { target: { value: "Spoilage" } });
    fireEvent.click(screen.getByRole("button", { name: "Save remarks" }));

    await waitFor(() => expect(api.setCountRemarks).toHaveBeenCalledWith(5, "2026-10-09", "NIGHT", "ONLINE", "Spoilage"));
    expect(await screen.findByRole("button", { name: "Saved" })).toBeTruthy();
  });

  it("only offers remarks once a count is saved", async () => {
    api.getVarianceTrace.mockResolvedValue(trace({ count: null }));
    open();
    expect(await screen.findByText(/No count saved for this location yet/)).toBeTruthy();
    expect(screen.queryByPlaceholderText(/Spoilage, damaged/)).toBeNull();
  });

  it("is read-only without edit rights", async () => {
    open(["ONLINE"], false);
    const box = await screen.findByPlaceholderText(/Spoilage, damaged/);
    expect((box as HTMLInputElement).disabled).toBe(true);
    expect(screen.queryByRole("button", { name: "Save remarks" })).toBeNull();
  });

  it("shows one section per visible location", async () => {
    api.getVarianceTrace.mockImplementation((_p: number, _d: string, _s: string, loc: string) => Promise.resolve(trace({ location: loc as "ONLINE" | "OFFLINE" })));
    open(["OFFLINE", "ONLINE"]);
    expect(await screen.findByLabelText("Offline details")).toBeTruthy();
    expect(screen.getByLabelText("Online details")).toBeTruthy();
    expect(api.getVarianceTrace).toHaveBeenCalledTimes(2);
  });

  it("explains a failed load instead of leaving a spinner", async () => {
    api.getVarianceTrace.mockRejectedValue(new Error("Active product not found"));
    open();
    expect(await screen.findByRole("alert")).toBeTruthy();
  });

  it("says a count is not published yet, so the next shift still opens from the system stock", async () => {
    open();
    expect(await screen.findByText(/Not published yet/)).toBeTruthy();
  });

  it("says when a count was published and became the next opening stock", async () => {
    api.getVarianceTrace.mockResolvedValue(
      trace({ count: { manualCount: 100, systemRemainingStock: 105, variance: 5, remarks: null, countedBy: "Ana Cruz", countedAt: null, publishedAt: "2026-10-09T22:00:00.000Z" } }),
    );
    open();
    expect(await screen.findByText(/Published .* next shift's opening stock/)).toBeTruthy();
    expect(screen.queryByText(/Not published yet/)).toBeNull();
  });
});
