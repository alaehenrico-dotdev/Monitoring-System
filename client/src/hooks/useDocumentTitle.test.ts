import { describe, expect, it } from "vitest";
import { titleFor } from "./useDocumentTitle";

describe("titleFor", () => {
  it("puts the page name first so it survives the tab's truncation", () => {
    expect(titleFor("/dashboard")).toBe("Dashboard · Ala Eh");
    expect(titleFor("/login")).toBe("Sign in · Ala Eh");
  });
  it("ignores a trailing slash", () => {
    expect(titleFor("/settings/")).toBe("Settings · Ala Eh");
  });
  it("falls back to the short brand for unknown paths", () => {
    expect(titleFor("/")).toBe("Ala Eh Stocks");
    expect(titleFor("/nope")).toBe("Ala Eh Stocks");
  });
});
