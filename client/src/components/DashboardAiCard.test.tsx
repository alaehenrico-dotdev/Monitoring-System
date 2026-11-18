import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { DashboardAiCard } from "./DashboardAiCard";
import { resetAiAvailableCache } from "../hooks/useAiAvailable";

const api = vi.hoisted(() => ({ getAiStatus: vi.fn(), getWhatChanged: vi.fn(), askData: vi.fn() }));
vi.mock("../api/ai", () => api);

const delta = (previous: number, current: number, changePct: number | null) => ({ previous, current, change: current - previous, changePct });
const facts = (over = {}) => ({
  days: 7,
  current: { from: "2026-11-08", to: "2026-11-14" },
  previous: { from: "2026-11-01", to: "2026-11-07" },
  currentWindowMayBePartial: true,
  enoughHistory: true,
  totals: {
    totalOut: delta(100, 130, 30), onlineOut: delta(0, 0, null), offlineOut: delta(0, 0, null), backloads: delta(5, 5, 0),
    rts: delta(0, 2, null), productionIn: delta(50, 40, -20), absVariance: delta(0, 12, null), flaggedProducts: delta(0, 2, null),
  },
  outflowUp: [{ sku: "S1", name: "Soy Sauce", unit: "pc", previous: 40, current: 70, change: 30 }],
  outflowDown: [],
  varianceUp: [{ sku: "S2", name: "Oil", unit: "pc", previous: 0, current: 12, change: 12 }],
  ...over,
});

beforeEach(() => {
  // jsdom has no layout, so no scrollIntoView (the dropdown calls it on open).
  Element.prototype.scrollIntoView = vi.fn();
  vi.clearAllMocks();
  resetAiAvailableCache();
  api.getAiStatus.mockResolvedValue({ enabled: true, model: "m", windows: [1, 7, 14, 30] });
});

describe("DashboardAiCard", () => {
  it("renders nothing when the server has no AI key", async () => {
    api.getAiStatus.mockResolvedValue({ enabled: false, model: null, windows: [] });
    const { container } = render(<DashboardAiCard />);
    await waitFor(() => expect(api.getAiStatus).toHaveBeenCalled());
    expect(container.innerHTML).toBe("");
  });

  it("renders nothing when the status check fails", async () => {
    api.getAiStatus.mockRejectedValue(new Error("boom"));
    const { container } = render(<DashboardAiCard />);
    await waitFor(() => expect(api.getAiStatus).toHaveBeenCalled());
    expect(container.innerHTML).toBe("");
  });

  it("spends nothing until someone clicks", async () => {
    render(<DashboardAiCard />);
    await screen.findByText("What changed?");
    expect(api.getWhatChanged).not.toHaveBeenCalled();
    expect(api.askData).not.toHaveBeenCalled();
  });
});

describe("What changed?", () => {
  it("shows the AI summary beside the server's numbers", async () => {
    api.getWhatChanged.mockResolvedValue({ facts: facts(), explanation: "Soy Sauce drove the rise.", model: "m" });
    render(<DashboardAiCard />);
    fireEvent.click(await screen.findByLabelText("Comparison window"));
    fireEvent.click(await screen.findByRole("option", { name: /Last 14 days/ }));
    fireEvent.click(screen.getByText("Compare"));
    expect(await screen.findByText("Soy Sauce drove the rise.")).toBeTruthy();
    expect(api.getWhatChanged).toHaveBeenCalledWith(14);
    expect(screen.getByText(/latest day may be incomplete/)).toBeTruthy();
    expect(screen.getByText("+30 +30%")).toBeTruthy();
    // A zero baseline is "new", not an invented percentage.
    expect(screen.getAllByText("+12 new").length).toBeGreaterThan(0);
    expect(screen.getByText(/40 → 70 pc \(\+30\)/)).toBeTruthy();
  });

  it("says there is nothing to compare with when there is no earlier data", async () => {
    api.getWhatChanged.mockResolvedValue({ facts: facts({ enoughHistory: false }), explanation: null, model: "m" });
    render(<DashboardAiCard />);
    fireEvent.click(await screen.findByText("Compare"));
    expect(await screen.findByText(/nothing to compare with yet/)).toBeTruthy();
  });

  it("shows a calm placeholder, not an error, when the comparison cannot be made - and can retry", async () => {
    api.getWhatChanged.mockRejectedValueOnce(new Error("The AI service did not respond. Try again in a moment.")).mockResolvedValueOnce({ facts: facts(), explanation: "Back.", model: "m" });
    render(<DashboardAiCard />);
    fireEvent.click(await screen.findByText("Compare"));
    const note = await screen.findByRole("status");
    expect(note.textContent).toContain("Couldn't compare these periods right now");
    expect(screen.queryByRole("alert")).toBeNull();
    fireEvent.click(screen.getByText("Try again"));
    expect(await screen.findByText("Back.")).toBeTruthy();
  });

  it("keeps the figures when only the AI summary is unavailable", async () => {
    api.getWhatChanged.mockResolvedValue({ facts: facts(), explanation: null, unavailable: "The AI service did not respond.", model: "m" });
    render(<DashboardAiCard />);
    fireEvent.click(await screen.findByText("Compare"));
    expect(await screen.findByText(/figures here are still current/)).toBeTruthy();
    expect(screen.getByText("+30 +30%")).toBeTruthy();
    expect(screen.queryByRole("alert")).toBeNull();
  });
});

describe("Ask the data", () => {
  const input = () => screen.findByLabelText("Your question");

  it("asks the typed question and lists what the answer was based on", async () => {
    api.askData.mockResolvedValue({
      answer: "Soy Sauce was short in 3 audits, 2026-11-01 to 2026-11-14.",
      sources: [{ tool: "variance_by_product", args: { from: "2026-11-01", to: "2026-11-14", limit: 5 }, result: { products: [{ name: "Soy Sauce" }] } }],
      model: "m",
    });
    render(<DashboardAiCard />);
    fireEvent.change(await input(), { target: { value: "Which products are short most often?" } });
    fireEvent.click(screen.getByText("Ask"));
    expect(await screen.findByText(/short in 3 audits/)).toBeTruthy();
    expect(api.askData).toHaveBeenCalledWith("Which products are short most often?");
    expect(screen.getByText(/Based on: Variance by product/).textContent).toContain("2026-11-01 → 2026-11-14");
  });

  it("will not send a question that is too short", async () => {
    render(<DashboardAiCard />);
    fireEvent.change(await input(), { target: { value: "hi" } });
    expect((screen.getByText("Ask") as HTMLButtonElement).disabled).toBe(true);
  });

  it("asks an example question when it is clicked", async () => {
    api.askData.mockResolvedValue({ answer: "Nothing needs attention.", sources: [], model: "m" });
    render(<DashboardAiCard />);
    fireEvent.click(await screen.findByText("What needs attention right now?"));
    expect(await screen.findByText("Nothing needs attention.")).toBeTruthy();
    expect(api.askData).toHaveBeenCalledWith("What needs attention right now?");
    expect(screen.getByText(/No figures were looked up/)).toBeTruthy();
  });

  it("shows a calm placeholder when the AI cannot answer, with a retry that asks the same question", async () => {
    api.askData.mockRejectedValueOnce(new Error("That took too long. Try a narrower question.")).mockResolvedValueOnce({ answer: "Fine now.", sources: [], model: "m" });
    render(<DashboardAiCard />);
    fireEvent.change(await input(), { target: { value: "What needs attention?" } });
    fireEvent.click(screen.getByText("Ask"));
    expect((await screen.findByRole("status")).textContent).toContain("The AI isn't available right now");
    expect(screen.queryByRole("alert")).toBeNull();
    fireEvent.click(screen.getByText("Try again"));
    expect(await screen.findByText("Fine now.")).toBeTruthy();
    expect(api.askData).toHaveBeenLastCalledWith("What needs attention?");
  });

  it("names the setting to fix when the problem is the AI's setup (no pointless retry)", async () => {
    api.askData.mockRejectedValue(new Error("The AI model is not available. Ask an admin to check GEMINI_MODEL."));
    render(<DashboardAiCard />);
    fireEvent.change(await input(), { target: { value: "What needs attention?" } });
    fireEvent.click(screen.getByText("Ask"));
    expect((await screen.findByRole("status")).textContent).toContain("GEMINI_MODEL");
    expect(screen.queryByText("Try again")).toBeNull();
  });
});

describe("a Google usage limit", () => {
  it("shows the calm placeholder with where to look as a detail line, and still offers Try again", async () => {
    api.askData.mockRejectedValue(new Error("The AI has reached its Google usage limit for now. Try again in a minute; if it keeps happening, check the key's quota and billing in Google AI Studio."));
    render(<DashboardAiCard />);
    fireEvent.change(await screen.findByLabelText("Your question"), { target: { value: "What needs attention?" } });
    fireEvent.click(screen.getByText("Ask"));
    const note = await screen.findByRole("status");
    expect(note.textContent).toContain("The AI isn't available right now");
    expect(note.textContent).toContain("quota and billing in Google AI Studio");
    expect(screen.getByText("Try again")).toBeTruthy();
  });
});
