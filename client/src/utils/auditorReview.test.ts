import { describe, expect, it } from "vitest";
import type { AdminSubmission } from "../api/countSubmissions";
import { auditorsDisagree, buildAuditorCells, cellKey, needsReview, planStageAuditor, rowNeedsReview } from "./auditorReview";

const sub = (id: number, name: string, status: "DRAFT" | "SUBMITTED", lines: AdminSubmission["lines"]): AdminSubmission => ({
  id,
  auditor: { id, name },
  status,
  submittedAt: status === "SUBMITTED" ? "2026-11-21T14:00:00.000Z" : null,
  reopenedAt: null,
  reopenReason: null,
  updatedAt: "2026-11-21T14:00:00.000Z",
  counted: { ONLINE: 0, OFFLINE: 0 },
  lines,
});
const L = (productId: number, location: "ONLINE" | "OFFLINE", qty: number | null, note: string | null = null) => ({ productId, location, qty, note });

describe("buildAuditorCells", () => {
  it("collects each submitted auditor's figure per cell, and ignores drafts and note-only lines", () => {
    const cells = buildAuditorCells([
      sub(1, "Ana Cruz", "SUBMITTED", [L(1, "ONLINE", 12), L(2, "ONLINE", null, "damaged")]),
      sub(2, "Ben Lim", "SUBMITTED", [L(1, "ONLINE", 11)]),
      sub(3, "Cy Tan", "DRAFT", [L(1, "ONLINE", 99)]),
    ]);
    expect(cells.get(cellKey("ONLINE", 1))?.map((c) => [c.name, c.qty])).toEqual([["Ana Cruz", 12], ["Ben Lim", 11]]);
    expect(cells.has(cellKey("ONLINE", 2))).toBe(false);
  });
});

describe("agreement", () => {
  const two = (a: number, b: number) => [
    { auditorId: 1, name: "A", qty: a, note: null },
    { auditorId: 2, name: "B", qty: b, note: null },
  ];
  it("knows when auditors agree and what they agreed on", () => {
    expect(auditorsDisagree(two(5, 5))).toBe(false);
    expect(auditorsDisagree(two(5, 6))).toBe(true);
  });

  it("needs a decision until the table holds one of the figures given", () => {
    expect(needsReview(two(5, 5), null)).toBe(true);
    expect(needsReview(two(5, 5), 8)).toBe(true);
    expect(needsReview(two(5, 5), 5)).toBe(false);
    // A disagreement is settled by choosing either figure.
    expect(needsReview(two(5, 6), 6)).toBe(false);
    expect(needsReview(two(5, 6), 7)).toBe(true);
    expect(needsReview([], null)).toBe(false);
  });
});

describe("planStageAuditor", () => {
  const ana = sub(1, "Ana", "SUBMITTED", [L(1, "ONLINE", 10), L(2, "ONLINE", 4), L(3, "ONLINE", null, "note only"), L(4, "OFFLINE", 2)]);
  const saved: Record<string, number | null> = { "ONLINE:1": 8, "ONLINE:2": 4 };
  const current = (loc: string, id: number) => saved[`${loc}:${id}`] ?? null;

  it("stages every figure that auditor gave which the table does not hold yet", () => {
    expect(planStageAuditor(ana, ["ONLINE", "OFFLINE"], current as never)).toEqual([
      { loc: "ONLINE", productId: 1, value: "10" },
      { loc: "OFFLINE", productId: 4, value: "2" },
    ]);
  });

  it("only looks at the locations on screen", () => {
    expect(planStageAuditor(ana, ["OFFLINE"], current as never)).toEqual([{ loc: "OFFLINE", productId: 4, value: "2" }]);
  });

  it("stages nothing from a count that is not submitted", () => {
    expect(planStageAuditor(sub(2, "Ben", "DRAFT", [L(1, "ONLINE", 9)]), ["ONLINE"], current as never)).toEqual([]);
  });
});

describe("rowNeedsReview", () => {
  it("is true while any shown location of the product is undecided", () => {
    const cells = buildAuditorCells([sub(1, "Ana", "SUBMITTED", [L(1, "ONLINE", 3), L(1, "OFFLINE", 4)])]);
    const cur = (loc: string) => (loc === "ONLINE" ? 3 : null);
    expect(rowNeedsReview(1, ["ONLINE"], cells, cur as never)).toBe(false);
    expect(rowNeedsReview(1, ["ONLINE", "OFFLINE"], cells, cur as never)).toBe(true);
    expect(rowNeedsReview(2, ["ONLINE", "OFFLINE"], cells, cur as never)).toBe(false);
  });
});
