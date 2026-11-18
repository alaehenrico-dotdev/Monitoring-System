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
  localStorage.clear();
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

  it("stays in the AI chat while the next question is typed, and leaves it with Back to search", async () => {
    mocks.askData.mockResolvedValue({ answer: "Answer.", sources: [], model: "m" });
    const input = await openPalette();
    type(input, "what needs attention?");
    fireEvent.keyDown(input, { key: "Enter" });
    await screen.findByText("Answer.");
    // The box was emptied for the next message, and typing does not drop back to the result list.
    expect(input.value).toBe("");
    type(input, "dashboard");
    expect(screen.getByText("Answer.")).toBeTruthy();
    expect(options()).toHaveLength(0);
    expect(input.getAttribute("role")).toBeNull(); // a message box here, not a combobox
    fireEvent.click(screen.getByRole("button", { name: "Back to search" }));
    expect(screen.queryByText("Answer.")).toBeNull();
    expect(input.getAttribute("role")).toBe("combobox");
    type(input, "dashboard");
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

  it("answers one question at a time: a second Enter while one is on its way does nothing", async () => {
    let resolveFirst!: (v: unknown) => void;
    mocks.askData.mockReturnValueOnce(new Promise((r) => (resolveFirst = r)));
    const input = await openPalette();
    type(input, "what needs attention?");
    fireEvent.keyDown(input, { key: "Enter" });
    type(input, "which products are short?");
    fireEvent.keyDown(input, { key: "Enter" });
    expect(mocks.askData).toHaveBeenCalledTimes(1);
    await act(async () => resolveFirst({ answer: "First answer.", sources: [], model: "m" }));
    expect(await screen.findByText("First answer.")).toBeTruthy();
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

describe("QuickJump - the AI chat keeps its replies", () => {
  const reply = (answer: string) => ({ answer, sources: [{ tool: "open_issues", args: {} }], model: "m" });
  const send = (input: HTMLInputElement, text: string) => {
    type(input, text);
    fireEvent.keyDown(input, { key: "Enter" });
  };

  it("builds a thread: each question and its answer stay, newest last", async () => {
    mocks.askData.mockResolvedValueOnce(reply("Answer one.")).mockResolvedValueOnce(reply("Answer two."));
    const input = await openPalette();
    send(input, "what needs attention?");
    await screen.findByText("Answer one.");
    send(input, "which products are short?");
    await screen.findByText("Answer two.");
    const log = screen.getByRole("log", { name: "AI chat" });
    const text = log.textContent ?? "";
    expect(text.indexOf("what needs attention?")).toBeLessThan(text.indexOf("Answer one."));
    expect(text.indexOf("Answer one.")).toBeLessThan(text.indexOf("which products are short?"));
    expect(text.indexOf("which products are short?")).toBeLessThan(text.indexOf("Answer two."));
    expect(input.placeholder).toBe("Ask a follow-up…");
  });

  it("saves the replies, and a new visit to the palette offers them back first", async () => {
    mocks.askData.mockResolvedValue(reply("Saved answer."));
    const input = await openPalette();
    send(input, "what needs attention?");
    await screen.findByText("Saved answer.");
    // Escape leaves the chat, a second Escape closes the palette.
    fireEvent.keyDown(input, { key: "Escape" });
    expect(screen.getByRole("dialog")).toBeTruthy();
    fireEvent.keyDown(input, { key: "Escape" });
    expect(screen.queryByRole("dialog")).toBeNull();

    act(() => openQuickJump());
    await screen.findByRole("combobox");
    expect(options()[0]).toContain("AI chat · 1 saved reply");
    fireEvent.click(screen.getByRole("option", { name: /AI chat/ }));
    expect(screen.getByText("Saved answer.")).toBeTruthy();
    expect(screen.getByText("what needs attention?")).toBeTruthy();
    expect(mocks.askData).toHaveBeenCalledTimes(1); // reopening asks nothing
  });

  it("keeps the replies in the browser, per signed-in user", async () => {
    mocks.askData.mockResolvedValue(reply("Stored."));
    const input = await openPalette();
    send(input, "what needs attention?");
    await screen.findByText("Stored.");
    const saved = JSON.parse(localStorage.getItem("ae:ai-chat:anon")!);
    expect(saved).toHaveLength(1);
    expect(saved[0]).toMatchObject({ question: "what needs attention?", answer: "Stored." });
  });

  it("offers no chat row to normal search until there is something saved", async () => {
    const input = await openPalette();
    expect(options().some((o) => o.includes("AI chat"))).toBe(false);
    expect(input.getAttribute("role")).toBe("combobox");
  });

  it("offers no chat row at all when the AI is off, even with replies stored", async () => {
    localStorage.setItem("ae:ai-chat:anon", JSON.stringify([{ id: "a", at: 1, question: "q old", answer: "a old", sources: [] }]));
    mocks.aiOn = false;
    await openPalette();
    expect(options().some((o) => o.includes("AI chat"))).toBe(false);
  });

  it("does not show another person's saved chat", async () => {
    localStorage.setItem("ae:ai-chat:99", JSON.stringify([{ id: "a", at: 1, question: "theirs", answer: "their answer", sources: [] }]));
    await openPalette();
    expect(options().some((o) => o.includes("AI chat"))).toBe(false);
  });

  it("New chat forgets the saved replies, and an answer still on its way", async () => {
    let resolveSlow!: (v: unknown) => void;
    mocks.askData.mockResolvedValueOnce(reply("Old answer.")).mockReturnValueOnce(new Promise((r) => (resolveSlow = r)));
    const input = await openPalette();
    send(input, "what needs attention?");
    await screen.findByText("Old answer.");
    send(input, "which products are short?");
    fireEvent.click(screen.getByRole("button", { name: "New chat" }));
    expect(screen.queryByText("Old answer.")).toBeNull();
    expect(localStorage.getItem("ae:ai-chat:anon")).toBeNull();
    await act(async () => resolveSlow(reply("Late answer.")));
    expect(screen.queryByText("Late answer.")).toBeNull();
    expect(localStorage.getItem("ae:ai-chat:anon")).toBeNull();
  });

  it("still saves an answer that arrives after stepping back to searching", async () => {
    let resolveSlow!: (v: unknown) => void;
    mocks.askData.mockReturnValueOnce(new Promise((r) => (resolveSlow = r)));
    const input = await openPalette();
    send(input, "what needs attention?");
    fireEvent.keyDown(input, { key: "Escape" }); // back to searching while it is still thinking
    await act(async () => resolveSlow(reply("Arrived later.")));
    await waitFor(() => expect(JSON.parse(localStorage.getItem("ae:ai-chat:anon")!)[0].answer).toBe("Arrived later."));
  });

  it("empties an open chat when the saved chats are wiped (sign-out, data reset)", async () => {
    const { clearAllAiChats } = await import("../utils/aiChat");
    mocks.askData.mockResolvedValue(reply("Soon gone."));
    const input = await openPalette();
    send(input, "what needs attention?");
    await screen.findByText("Soon gone.");
    act(() => clearAllAiChats());
    expect(screen.queryByText("Soon gone.")).toBeNull();
    expect(localStorage.getItem("ae:ai-chat:anon")).toBeNull();
  });

  it("keeps Home and End for the caret in the message box (they only move the list in search)", async () => {
    mocks.askData.mockResolvedValue(reply("Answer."));
    const input = await openPalette();
    send(input, "what needs attention?");
    await screen.findByText("Answer.");
    const home = new KeyboardEvent("keydown", { key: "Home", bubbles: true, cancelable: true });
    input.dispatchEvent(home);
    expect(home.defaultPrevented).toBe(false);
  });
});
