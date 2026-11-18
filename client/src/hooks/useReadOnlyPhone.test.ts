import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { isPhoneView } from "./useReadOnlyPhone";

/// Evaluates PHONE_QUERY's comma list against a fake device: any clause that is
/// fully satisfied makes the whole query match, like a real browser.
function setDevice(d: { coarse: boolean; width: number; deviceWidth?: number; segments?: number; folded?: boolean }) {
  window.matchMedia = ((query: string) => ({
    matches: query.split(",").some((clause) => {
      const c = clause.trim();
      if (!d.coarse) return false;
      if (c.startsWith("(max-width: 700px)")) return d.width <= 700;
      if (c.includes("min-device-width: 600px")) return (d.deviceWidth ?? d.width) >= 600 && d.width <= 1400;
      if (c.includes("viewport-segments: 2")) return (d.segments ?? 1) === 2;
      if (c.includes("device-posture: folded")) return !!d.folded;
      return false;
    }),
    media: query,
    addEventListener: () => {},
    removeEventListener: () => {},
  })) as unknown as typeof window.matchMedia;
}

beforeEach(() => localStorage.clear());
afterEach(() => localStorage.clear());

describe("isPhoneView", () => {
  it("treats a narrow touch screen as a phone", () => {
    setDevice({ coarse: true, width: 360 });
    expect(isPhoneView()).toBe(true);
  });
  it("treats a half-folded foldable (744px, two segments) as a phone", () => {
    setDevice({ coarse: true, width: 744, segments: 2 });
    expect(isPhoneView()).toBe(true);
  });
  it("treats device-posture: folded as a phone", () => {
    setDevice({ coarse: true, width: 744, folded: true });
    expect(isPhoneView()).toBe(true);
  });
  it("treats a touch screen wider than any tablet (1600px) with no fold as desktop", () => {
    setDevice({ coarse: true, width: 1600 });
    expect(isPhoneView()).toBe(false);
  });
  it("treats a tablet (touch, 820px screen, desktop-sized layout) as a phone: read-only", () => {
    setDevice({ coarse: true, width: 1024, deviceWidth: 820 });
    expect(isPhoneView()).toBe(true);
    setDevice({ coarse: true, width: 1366, deviceWidth: 1024 });
    expect(isPhoneView()).toBe(true);
  });
  it("keeps a phone's \"Desktop site\" (980px layout on a 390px screen) as the way out", () => {
    setDevice({ coarse: true, width: 980, deviceWidth: 390 });
    expect(isPhoneView()).toBe(false);
  });
  it("leaves a very wide touch screen as desktop", () => {
    setDevice({ coarse: true, width: 1920, deviceWidth: 1920 });
    expect(isPhoneView()).toBe(false);
  });
  it("never treats a mouse computer as a phone", () => {
    setDevice({ coarse: false, width: 744, segments: 2 });
    expect(isPhoneView()).toBe(false);
  });
});
