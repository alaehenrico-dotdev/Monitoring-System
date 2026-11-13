import { describe, expect, it } from "vitest";
import {
  computeStats,
  generatePassage,
  keyForChar,
  type TypingMode,
} from "./typingTest";

describe("computeStats", () => {
  it("is 0 wpm and 100% before anything is typed", () => {
    expect(computeStats("abc", "", 1000)).toMatchObject({
      wpm: 0,
      accuracy: 100,
    });
  });

  it("counts five correct characters per word per minute", () => {
    // 50 correct chars in 60s = 10 wpm
    const t = "a".repeat(50);
    expect(computeStats(t, t, 60_000).wpm).toBe(10);
  });

  it("reports accuracy from mismatches", () => {
    const s = computeStats("abcd", "abxx", 60_000);
    expect(s.correct).toBe(2);
    expect(s.accuracy).toBe(50);
  });
});

import { keyIdFromEvent } from "./typingTest";

describe("keyboard model", () => {
  it("maps uppercase and shifted symbols to their base key plus shift", () => {
    expect(keyForChar("a")).toEqual({ id: "a", shift: false });
    expect(keyForChar("A")).toEqual({ id: "a", shift: true });
    expect(keyForChar(":")).toEqual({ id: ";", shift: true });
    expect(keyForChar(" ")).toEqual({ id: "Space", shift: false });
  });

  it("maps keystrokes to key ids", () => {
    expect(keyIdFromEvent({ key: "Q", code: "KeyQ" })).toBe("q");
    expect(keyIdFromEvent({ key: "Shift", code: "ShiftRight" })).toBe(
      "ShiftRight",
    );
    expect(keyIdFromEvent({ key: " ", code: "Space" })).toBe("Space");
  });
});

describe("generatePassage", () => {
  const modes: TypingMode[] = ["mix", "words", "sentences", "numbers"];

  it("only uses characters the on-screen keyboard has", () => {
    for (const m of modes)
      for (let i = 0; i < 50; i++)
        for (const ch of generatePassage(m))
          expect(keyForChar(ch), `${m}: "${ch}"`).not.toBeNull();
  });

  it("varies between runs and never repeats the previous passage", () => {
    for (const m of modes) {
      const seen = new Set<string>();
      let prev: string | undefined;
      for (let i = 0; i < 30; i++) {
        const p = generatePassage(m, prev);
        expect(p).not.toBe(prev);
        seen.add(p);
        prev = p;
      }
      expect(seen.size).toBeGreaterThan(25);
    }
  });

  it("makes numbers mode digits and codes only", () => {
    expect(generatePassage("numbers")).toMatch(/^[0-9A-E\- ]+$/);
  });

  it("is deterministic for a seeded random source", () => {
    const seq = () => {
      let s = 7;
      return () => (s = (s * 16807) % 2147483647) / 2147483647;
    };
    expect(generatePassage("words", undefined, seq())).toBe(
      generatePassage("words", undefined, seq()),
    );
  });
});
