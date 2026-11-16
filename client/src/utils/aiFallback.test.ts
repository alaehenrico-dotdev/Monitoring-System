import { describe, expect, it } from "vitest";
import { ApiError } from "../api/http";
import { AI_PLACEHOLDER, aiFallback } from "./aiFallback";

const P = AI_PLACEHOLDER.ask;

describe("aiFallback - what a failed AI request looks like", () => {
  it("shows the calm placeholder and offers Try again for an ordinary failure", () => {
    expect(aiFallback(new Error("The AI service did not respond. Try again in a moment."), P)).toEqual({ text: P, retry: true });
    expect(aiFallback(new TypeError("Request timed out"), P)).toEqual({ text: P, retry: true });
    expect(aiFallback("not even an Error", P)).toEqual({ text: P, retry: true });
  });

  it("keeps a rejected-input message (a 400), since that is the useful one", () => {
    expect(aiFallback(new ApiError(400, "Ask a question of a few words."), P)).toEqual({ text: "Ask a question of a few words.", retry: false });
  });

  it("shows setup problems as a detail line with no Try again (the key, the model, the daily cap)", () => {
    for (const m of [
      "The AI service rejected the API key. Ask an admin to check GEMINI_API_KEY (and its restrictions in Google AI Studio).",
      "The AI model is not available. Ask an admin to check GEMINI_MODEL.",
      "The AI has reached today's call limit for this server. Ask an admin to raise AI_DAILY_CALL_LIMIT, or try again tomorrow.",
    ]) {
      expect(aiFallback(new ApiError(429, m), P)).toEqual({ text: P, detail: m, retry: false });
    }
  });

  it("explains a Google usage limit as a detail line, and still allows a retry (it often clears in a minute)", () => {
    const m = "The AI has reached its Google usage limit for now. Try again in a minute; if it keeps happening, check the key's quota and billing in Google AI Studio.";
    expect(aiFallback(new Error(m), P)).toEqual({ text: P, detail: m, retry: true });
  });
});
