import { beforeEach, describe, expect, it } from "vitest";
import { clearAllHistory, loadHistory, saveHistory } from "./sessionHistory";
import { clearSheetViews, rememberSheet, resumeSheet } from "./sheetView";

beforeEach(() => sessionStorage.clear());

describe("sessionHistory", () => {
  it("round-trips a sheet's undo/redo history", () => {
    saveHistory("online:2026-10-13:MORNING", [{ a: 1 }, { a: 2 }], [{ a: 3 }]);
    expect(loadHistory("online:2026-10-13:MORNING")).toEqual({ past: [{ a: 1 }, { a: 2 }], future: [{ a: 3 }] });
  });

  it("keeps each sheet's history separate", () => {
    saveHistory("a", [1], []);
    expect(loadHistory("b")).toEqual({ past: [], future: [] });
  });

  it("removes the entry once both stacks are empty", () => {
    saveHistory("a", [1], []);
    saveHistory("a", [], []);
    expect(sessionStorage.length).toBe(0);
  });

  it("caps what it stores to the most recent steps", () => {
    saveHistory("a", Array.from({ length: 100 }, (_, i) => i), []);
    const { past } = loadHistory<number>("a");
    expect(past).toHaveLength(40);
    expect(past[past.length - 1]).toBe(99);
  });

  it("survives corrupt storage and clears on demand", () => {
    sessionStorage.setItem("ala-eh-history:a", "{not json");
    expect(loadHistory("a")).toEqual({ past: [], future: [] });
    saveHistory("b", [1], []);
    clearAllHistory();
    expect(loadHistory("b")).toEqual({ past: [], future: [] });
  });
});

describe("sheetView", () => {
  it("resumes the last sheet only while it still has staged edits", () => {
    rememberSheet("online", "2026-10-12", "NIGHT");
    expect(resumeSheet("online")).toBeNull();
    sessionStorage.setItem("ala-eh-pending:online:2026-10-12:NIGHT", JSON.stringify({ 5: { rts: 3 } }));
    expect(resumeSheet("online")).toEqual({ date: "2026-10-12", shift: "NIGHT" });
  });

  it("does not resume a sheet whose edits were emptied, or another page's sheet", () => {
    rememberSheet("offline", "2026-10-12", "NIGHT");
    sessionStorage.setItem("ala-eh-pending:offline:2026-10-12:NIGHT", "{}");
    expect(resumeSheet("offline")).toBeNull();
    sessionStorage.setItem("ala-eh-pending:online:2026-10-12:NIGHT", JSON.stringify({ 1: { rts: 1 } }));
    expect(resumeSheet("offline")).toBeNull();
  });

  it("forgets remembered sheets on clear", () => {
    rememberSheet("online", "2026-10-12", "NIGHT");
    clearSheetViews();
    expect(sessionStorage.getItem("ala-eh-sheet-view:online")).toBeNull();
  });
});
