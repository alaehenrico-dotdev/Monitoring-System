import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

const mocks = vi.hoisted(() => ({ aiOn: true, phone: false, askData: vi.fn() }));
vi.mock("../hooks/useAiAvailable", () => ({ useAiAvailable: () => mocks.aiOn }));
vi.mock("../api/ai", () => ({ askData: mocks.askData }));
vi.mock("../context/AuthContext", () => ({ useAuth: () => ({ user: { role: "SUPERVISOR_ADMIN" } }) }));
vi.mock("../context/ThemeContext", () => ({ useTheme: () => ({ theme: "dark", toggleTheme: vi.fn() }) }));
vi.mock("../hooks/useReadOnlyPhone", () => ({ useReadOnlyPhone: () => mocks.phone }));
vi.mock("../api/products", async () => ({
  ...(await vi.importActual<typeof import("../api/products")>("../api/products")),
  listProducts: vi.fn().mockResolvedValue([]),
}));
vi.mock("../api/totalStocks", () => ({ getTotalStocks: vi.fn().mockResolvedValue([]) }));

import { QuickJump, openQuickJump } from "./QuickJump";

async function openPalette() {
  render(
    <MemoryRouter>
      <QuickJump />
    </MemoryRouter>,
  );
  act(() => openQuickJump());
  return (await screen.findByRole("combobox")) as HTMLInputElement;
}
const type = (input: HTMLInputElement, value: string) => fireEvent.change(input, { target: { value } });
const options = () => screen.queryAllByRole("option").map((o) => o.textContent ?? "");

beforeEach(() => {
  vi.clearAllMocks();
  mocks.aiOn = true;
  mocks.phone = false;
  // jsdom has no scrollIntoView; the palette calls it to keep the active row in view.
  Element.prototype.scrollIntoView = vi.fn();
});

describe("QuickJump - the header search with AI", () => {
  it("offers nothing new when the AI is not available", async () => {
    mocks.aiOn = false;
    const input = await openPalette();
    type(input, "what needs attention?");
    expect(options().some((o) => o.includes("Ask AI"))).toBe(false);
    expect(input.placeholder).toBe("Jump to a page or product…");
  });

  it("lists 'Ask AI' LAST for page-like text, so Enter still jumps to the best match", async () => {
    const input = await openPalette();
    type(input, "dashboard");
    const list = options();
    expect(list.at(-1)).toContain("Ask AI: dashboard");
    expect(list[0]).not.toContain("Ask AI");
    fireEvent.keyDown(input, { key: "Enter" });
    expect(mocks.askData).not.toHaveBeenCalled();
  });

  it("lists 'Ask AI' FIRST for a question, and Enter asks it and shows the answer in place", async () => {
    mocks.askData.mockResolvedValue({
      answer: "Two things need attention: a backup is overdue and 3 variances have no reason.",
      sources: [{ tool: "open_issues", args: {} }],
      model: "m",
    });
    const input = await openPalette();
    type(input, "what needs attention?");
    expect(options()[0]).toContain("Ask AI: what needs attention?");
    fireEvent.keyDown(input, { key: "Enter" });

    expect(await screen.findByText("Thinking…")).toBeTruthy();
    expect(await screen.findByText(/backup is overdue/)).toBeTruthy();
    expect(mocks.askData).toHaveBeenCalledWith("what needs attention?");
    expect(screen.getByText(/Based on Admin queue/)).toBeTruthy();
    // The answer replaced the list, and the palette is still open.
    expect(screen.queryAllByRole("option")).toHaveLength(0);
    expect(screen.getByRole("dialog")).toBeTruthy();
  });

  it("goes back to searching as soon as the text is edited", async () => {
    mocks.askData.mockResolvedValue({ answer: "Answer.", sources: [], model: "m" });
    const input = await openPalette();
    type(input, "what needs attention?");
    fireEvent.keyDown(input, { key: "Enter" });
    await screen.findByText("Answer.");
    type(input, "dashboard");
    expect(screen.queryByText("Answer.")).toBeNull();
    expect(options().length).toBeGreaterThan(0);
  });

  it("asks with Ctrl+Enter whatever was typed", async () => {
    mocks.askData.mockResolvedValue({ answer: "Answer.", sources: [], model: "m" });
    const input = await openPalette();
    type(input, "dashboard");
    fireEvent.keyDown(input, { key: "Enter", ctrlKey: true });
    await screen.findByText("Answer.");
    expect(mocks.askData).toHaveBeenCalledWith("dashboard");
  });

  it("does not ask for a couple of letters", async () => {
    const input = await openPalette();
    type(input, "so");
    expect(options().some((o) => o.includes("Ask AI"))).toBe(false);
    fireEvent.keyDown(input, { key: "Enter", ctrlKey: true });
    expect(mocks.askData).not.toHaveBeenCalled();
  });

  it("shows a calm note, not a red alert, when the AI cannot answer - and Try again asks the same question", async () => {
    mocks.askData.mockRejectedValueOnce(new Error("The AI service did not respond. Try again in a moment.")).mockResolvedValueOnce({ answer: "Back now.", sources: [], model: "m" });
    const input = await openPalette();
    type(input, "what needs attention?");
    fireEvent.keyDown(input, { key: "Enter" });
    expect(await screen.findByText(/The AI isn't available right now/)).toBeTruthy();
    expect(screen.getByText(/Pages and products still work/)).toBeTruthy();
    expect(screen.queryByRole("alert")).toBeNull();
    fireEvent.click(screen.getByText("Try again"));
    expect(await screen.findByText("Back now.")).toBeTruthy();
    expect(mocks.askData).toHaveBeenLastCalledWith("what needs attention?");
  });

  it("drops a late answer for an edited question", async () => {
    let resolveFirst!: (v: unknown) => void;
    mocks.askData.mockReturnValueOnce(new Promise((r) => (resolveFirst = r))).mockRejectedValueOnce(new Error("The AI service is busy. Try again in a minute."));
    const input = await openPalette();
    type(input, "what needs attention?");
    fireEvent.keyDown(input, { key: "Enter" });
    type(input, "which products are short?");
    fireEvent.keyDown(input, { key: "Enter" });
    expect(await screen.findByText(/The AI isn't available right now/)).toBeTruthy();
    // The first question's answer arrives late; it must not replace the second's result.
    await act(async () => resolveFirst({ answer: "STALE", sources: [], model: "m" }));
    await waitFor(() => expect(screen.queryByText("STALE")).toBeNull());
  });

  it("works on the phone view too: the same underline class, a short placeholder, and a tappable Ask AI row", async () => {
    mocks.phone = true;
    mocks.askData.mockResolvedValue({ answer: "Phone answer.", sources: [], model: "m" });
    const input = await openPalette();
    expect(screen.getByRole("dialog").className).toContain("ae-quickjump--phone");
    expect(screen.getByRole("dialog").className).toContain("ae-quickjump--ai");
    expect(input.placeholder).toBe("Search, or ask a question…");
    type(input, "which products are short?");
    fireEvent.click(screen.getByRole("option", { name: /Ask AI/ }));
    expect(await screen.findByText("Phone answer.")).toBeTruthy();
    expect(mocks.askData).toHaveBeenCalledWith("which products are short?");
  });
});
