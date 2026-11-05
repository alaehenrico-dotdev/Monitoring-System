import { describe, expect, it } from "vitest";
import { faviconFrame } from "./useAnimatedFavicon";

describe("faviconFrame", () => {
  it("is an SVG data URL", () => {
    expect(faviconFrame(0, "busy")).toMatch(/^data:image\/svg\+xml,/);
  });
  it("rotates the arc from frame to frame", () => {
    expect(faviconFrame(0, "busy")).not.toBe(faviconFrame(3, "busy"));
    expect(decodeURIComponent(faviconFrame(3, "busy"))).toContain("rotate(90 32 32)");
  });
  it("turns amber when slow", () => {
    expect(decodeURIComponent(faviconFrame(0, "slow"))).toContain("#FF9F1C");
  });
});

describe("faviconFrame caching", () => {
  it("returns the same string for the same frame, built once", () => {
    expect(faviconFrame(5, "busy")).toBe(faviconFrame(5, "busy"));
  });
});
