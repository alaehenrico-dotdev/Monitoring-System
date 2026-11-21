import { describe, expect, it } from "vitest";
import { AUDITOR_HOME, defaultGridPageFor, desktopHomeFor, isPhonePage, pagesForRole, phoneHomeFor, phoneNavPages } from "./navigation";

describe("the auditor role's pages", () => {
  it("sees only the count page and Settings", () => {
    expect(pagesForRole("AUDITOR").map((p) => p.to)).toEqual([AUDITOR_HOME, "/settings"]);
  });

  it("is the only role offered the count page", () => {
    for (const role of ["ENCODER", "SUPERVISOR_ADMIN"] as const) {
      expect(pagesForRole(role).map((p) => p.to)).not.toContain(AUDITOR_HOME);
    }
  });

  it("gets a phone bar of Count and Settings, and lands on the count page on a phone and a computer", () => {
    expect(phoneNavPages("AUDITOR").map((p) => p.to)).toEqual([AUDITOR_HOME, "/settings"]);
    expect(phoneHomeFor("AUDITOR")).toBe(AUDITOR_HOME);
    expect(desktopHomeFor("AUDITOR")).toBe(AUDITOR_HOME);
    expect(defaultGridPageFor("AUDITOR", true)).toBe(AUDITOR_HOME);
    expect(isPhonePage(AUDITOR_HOME)).toBe(true);
  });

  it("leaves everyone else's landing pages alone", () => {
    expect(phoneHomeFor("SUPERVISOR_ADMIN")).toBe("/dashboard");
    expect(phoneHomeFor("ENCODER")).toBe("/daily-report");
    expect(desktopHomeFor("ENCODER")).toBe("/online");
    expect(defaultGridPageFor("ENCODER", true)).toBe("/total-stocks");
    expect(defaultGridPageFor("SUPERVISOR_ADMIN")).toBe("/online");
  });
});
