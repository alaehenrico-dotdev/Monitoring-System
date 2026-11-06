import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { HEADER_STYLES } from "./context/ThemeContext";

// Guards on the header layouts' stylesheet (jsdom applies no CSS): what the layouts promise is that they
// only ever arrange the header - never unpin it - and that each one is reachable only by its own
// setting and wins over every theme.
const css = readFileSync(join(__dirname, "styles/header-styles.css"), "utf8");
const index = readFileSync(join(__dirname, "index.css"), "utf8");

// Every rule as { selectors, body }, comments and @media wrappers stripped.
const stripped = css.replace(/\/\*[\s\S]*?\*\//g, "");
const rules = [...stripped.matchAll(/([^{}@]+)\{([^{}]*)\}/g)].map((m) => ({
  selectors: m[1].split(",").map((s) => s.trim()).filter(Boolean),
  body: m[2],
}));
const allSelectors = rules.flatMap((r) => r.selectors);

describe("header layouts stylesheet", () => {
  it("has rules, and every selector is scoped to a header layout", () => {
    expect(allSelectors.length).toBeGreaterThan(30);
    for (const s of allSelectors) expect(s).toContain('[data-header="');
  });

  it("styles exactly the layouts the setting offers beyond standard (standard is the unstyled original)", () => {
    const used = new Set([...css.matchAll(/\[data-header="(\w+)"\]/g)].map((m) => m[1]));
    expect([...used].sort()).toEqual(HEADER_STYLES.filter((h) => h !== "standard").sort());
    expect(HEADER_STYLES[0]).toBe("standard");
  });

  it("out-ranks the themes' own header rules with a triple :root prefix on every selector", () => {
    for (const s of allSelectors) expect(s.startsWith(':root:root:root[data-header="')).toBe(true);
  });

  it("never moves the pinned unit: nothing sets `position` on .ae-sticky-head, and it stays sticky", () => {
    const sticky = rules.filter((r) => r.selectors.some((s) => /\.ae-sticky-head$/.test(s)));
    expect(sticky.length).toBeGreaterThan(0); // floating insets it
    for (const r of sticky) expect(r.body).not.toMatch(/(^|[;\s])position\s*:/);
    // The top offset is never negative or large: the header stays at the very top.
    for (const r of sticky) {
      const top = r.body.match(/(^|[;\s])top\s*:\s*(-?\d+)px/);
      if (top) expect(Number(top[2])).toBeGreaterThanOrEqual(0);
      if (top) expect(Number(top[2])).toBeLessThanOrEqual(12);
    }
  });

  it("does not hide the header, its controls or the page tabs", () => {
    const hiding = rules.filter((r) => /display\s*:\s*none/.test(r.body)).flatMap((r) => r.selectors);
    // Only decorative bits are ever removed: the per-tab underline, the pill bar's pseudo-element feet.
    for (const s of hiding) expect(s).toMatch(/(::after|::before)$/);
    expect(hiding.length).toBeGreaterThan(0); // the guard is looking at something
  });

  it("is loaded after every theme, so it can arrange whichever one paints the header", () => {
    const at = (name: string) => index.indexOf(name);
    expect(at("header-styles.css")).toBeGreaterThan(at("themes/studio.css"));
    expect(at("header-styles.css")).toBeGreaterThan(at("themes/minimalism.css"));
    expect(at("header-styles.css")).toBeGreaterThan(at("menu-bar.css"));
  });
});
