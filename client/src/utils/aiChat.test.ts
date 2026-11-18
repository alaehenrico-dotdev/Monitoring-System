import { beforeEach, describe, expect, it } from "vitest";
import { appendTurn, clearAllAiChats, loadChat, MAX_TURNS, newTurnId, saveChat, type ChatTurn } from "./aiChat";

const turn = (n: number, extra: Partial<ChatTurn> = {}): ChatTurn => ({
  id: `t${n}`,
  at: 1000 + n,
  question: `question ${n}`,
  answer: `answer ${n}`,
  sources: [],
  ...extra,
});

beforeEach(() => localStorage.clear());

describe("saved AI chat", () => {
  it("round-trips the turns, oldest first", () => {
    const turns = [turn(1, { sources: [{ tool: "period_summary", args: { limit: 1 } }] }), turn(2)];
    saveChat("7", turns);
    expect(loadChat("7")).toEqual(turns);
  });

  it("keeps each user's chat separate", () => {
    saveChat("7", [turn(1)]);
    saveChat("8", [turn(2)]);
    expect(loadChat("7").map((t) => t.id)).toEqual(["t1"]);
    expect(loadChat("8").map((t) => t.id)).toEqual(["t2"]);
    expect(loadChat("9")).toEqual([]);
  });

  it("keeps only the newest MAX_TURNS", () => {
    let turns: ChatTurn[] = [];
    for (let i = 0; i < MAX_TURNS + 5; i++) turns = appendTurn(turns, turn(i));
    expect(turns).toHaveLength(MAX_TURNS);
    expect(turns[0].id).toBe("t5");
    saveChat("7", turns);
    expect(loadChat("7")).toHaveLength(MAX_TURNS);
  });

  it("stores nothing for an empty chat (and removes what was there)", () => {
    saveChat("7", [turn(1)]);
    saveChat("7", []);
    expect(localStorage.getItem("ae:ai-chat:7")).toBeNull();
  });

  it("does not trust what it reads back: bad JSON, wrong shapes and half-turns are dropped", () => {
    localStorage.setItem("ae:ai-chat:7", "not json");
    expect(loadChat("7")).toEqual([]);
    localStorage.setItem("ae:ai-chat:7", JSON.stringify({ not: "an array" }));
    expect(loadChat("7")).toEqual([]);
    localStorage.setItem(
      "ae:ai-chat:7",
      JSON.stringify([
        turn(1),
        { id: "x", at: 1, question: "no answer" },
        { id: "y", at: "later", question: "q", answer: "a" },
        { id: "z", at: 1, question: "", answer: "a" },
        "string",
        null,
        turn(2, { sources: [{ tool: "ok", args: {} }, { tool: 5, args: {} }, { tool: "no args" }] as never }),
      ]),
    );
    const loaded = loadChat("7");
    expect(loaded.map((t) => t.id)).toEqual(["t1", "t2"]);
    expect(loaded[1].sources).toEqual([{ tool: "ok", args: {} }]);
  });

  it("caps an oversized stored question and answer", () => {
    localStorage.setItem("ae:ai-chat:7", JSON.stringify([turn(1, { question: "q".repeat(5000), answer: "a".repeat(50000) })]));
    const [t] = loadChat("7");
    expect(t.question.length).toBe(300);
    expect(t.answer.length).toBe(6000);
  });

  it("wipes every user's chat but nothing else", () => {
    saveChat("7", [turn(1)]);
    saveChat("8", [turn(2)]);
    localStorage.setItem("ae:calc-history", "[]");
    localStorage.setItem("ae:typing-best-wpm", "50");
    clearAllAiChats();
    expect(loadChat("7")).toEqual([]);
    expect(loadChat("8")).toEqual([]);
    expect(localStorage.getItem("ae:calc-history")).toBe("[]");
    expect(localStorage.getItem("ae:typing-best-wpm")).toBe("50");
  });

  it("makes ids that do not repeat", () => {
    expect(new Set(Array.from({ length: 50 }, newTurnId)).size).toBe(50);
  });
});
