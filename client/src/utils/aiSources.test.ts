import { describe, expect, it } from "vitest";
import { describeArgs, questionFirst, sourcesLine } from "./aiSources";

describe("questionFirst - when 'Ask AI' goes ahead of the page and product matches", () => {
  it("is true for a question mark or a question-word opening with a few words", () => {
    expect(questionFirst("soy sauce?")).toBe(true);
    expect(questionFirst("what needs attention")).toBe(true);
    expect(questionFirst("Which products are short")).toBe(true);
    expect(questionFirst("show variance this week")).toBe(true);
  });

  it("is false for things that look like a page or product, so Enter still jumps", () => {
    expect(questionFirst("dashboard")).toBe(false);
    expect(questionFirst("soy sauce premium 1l")).toBe(false);
    expect(questionFirst("online entry")).toBe(false);
    // Too short to be a sentence, even though it starts with a question word.
    expect(questionFirst("what")).toBe(false);
    expect(questionFirst("who is")).toBe(false);
  });
});

describe("describeArgs / sourcesLine", () => {
  it("shows the date range first, then the other arguments", () => {
    expect(describeArgs({ from: "2026-11-01", to: "2026-11-14", search: "soy", limit: 5 })).toBe("2026-11-01 → 2026-11-14, search: soy, limit: 5");
    expect(describeArgs({})).toBe("");
  });

  it("names each lookup in plain words", () => {
    expect(
      sourcesLine([
        { tool: "variance_by_product", args: { from: "2026-11-01", to: "2026-11-14" } },
        { tool: "open_issues", args: {} },
        { tool: "something_new", args: {} },
      ]),
    ).toBe("Variance by product (2026-11-01 → 2026-11-14) · Admin queue · something_new");
  });
});
