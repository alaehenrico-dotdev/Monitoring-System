import { afterEach, describe, expect, it, vi } from "vitest";
import { notifyDailyReportSaved, setReportSavedHandler } from "./reportSaved";

afterEach(() => setReportSavedHandler(null));

describe("notifyDailyReportSaved", () => {
  it("does nothing without a handler", () => {
    expect(() => notifyDailyReportSaved(new Date())).not.toThrow();
  });

  it("passes the date to the handler", () => {
    const h = vi.fn();
    setReportSavedHandler(h);
    const d = new Date("2026-10-22T00:00:00Z");
    notifyDailyReportSaved(d);
    expect(h).toHaveBeenCalledWith(d);
  });

  it("never lets a failing handler fail the save that called it", () => {
    const warn = vi.spyOn(console, "error").mockImplementation(() => {});
    setReportSavedHandler(() => {
      throw new Error("boom");
    });
    expect(() => notifyDailyReportSaved(new Date())).not.toThrow();
    warn.mockRestore();
  });
});
