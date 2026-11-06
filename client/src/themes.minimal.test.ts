import { readAllCss } from "./test-utils/css";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// Guards on the stylesheet itself (jsdom applies no CSS): the Minimalism theme's
// promises - readable in both colour modes, nothing decorative - and that the
// retired Card theme left nothing behind.
const css = readAllCss(join(__dirname, "index.css"));

const START = "Minimalism theme (Settings > Appearance > Theme)";
const startAt = css.indexOf(START);
const block = css.slice(css.lastIndexOf("/* ====", startAt), css.indexOf("/* ====", startAt + START.length));

function rule(selector: string): string {
  const at = block.indexOf(selector + " {");
  if (at < 0) throw new Error(`rule not found: ${selector}`);
  return block.slice(at, block.indexOf("}", at));
}
const LIGHT = rule(':root[data-ui="minimal"]:not([data-theme="dark"])');
const DARK = rule(':root[data-ui="minimal"][data-theme="dark"]');

const tokens = (body: string) => Object.fromEntries([...body.matchAll(/(--[\w-]+):\s*([^;]+);/g)].map((m) => [m[1], m[2].trim()]));
const light = tokens(LIGHT);
const dark = tokens(DARK);

const lum = (hex: string) => {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
const contrast = (a: string, b: string) => {
  const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
};

describe("the retired Card theme", () => {
  it("left no selectors behind", () => {
    expect(css).not.toContain('data-ui="card"');
  });
});

describe("Minimalism theme", () => {
  it("exists, scoped to its own data-ui value", () => {
    expect(startAt).toBeGreaterThan(0);
    expect(block).toContain(':root[data-ui="minimal"]');
    // Every selector in the block is scoped, so no other theme can be affected.
    const selectors = [...block.matchAll(/(^|\n)(:root[^{]*|[^\s/][^{\n]*)\{/g)].map((m) => m[2].trim());
    for (const s of selectors) expect(s).toContain('[data-ui="minimal"]');
  });

  it("defines the same tokens for light and dark, so neither mode inherits the other's by accident", () => {
    expect(Object.keys(dark).sort()).toEqual(Object.keys(light).sort());
  });

  it.each([
    ["light", light],
    ["dark", dark],
  ])("keeps text readable in %s mode (WCAG AA, 4.5:1)", (_mode, t) => {
    expect(contrast(t["--ae-text"], t["--ae-bg"])).toBeGreaterThanOrEqual(4.5);
    expect(contrast(t["--ae-text-muted"], t["--ae-bg"])).toBeGreaterThanOrEqual(4.5);
    expect(contrast(t["--ae-text-muted"], t["--ae-bg-alt"])).toBeGreaterThanOrEqual(4.5);
    expect(contrast(t["--ae-text"], t["--ae-surface"])).toBeGreaterThanOrEqual(4.5);
    // The primary button: its label on its ink fill.
    expect(contrast(t["--ae-mini-on-ink"], t["--ae-mini-ink"])).toBeGreaterThanOrEqual(7);
  });

  it("keeps field and button outlines visible against the page in both modes (WCAG 3:1 for UI boundaries)", () => {
    for (const t of [light, dark]) expect(contrast(t["--ae-border-strong"], t["--ae-bg"])).toBeGreaterThanOrEqual(3);
  });

  it("is flat: no gradients, no blur, no glow", () => {
    expect(block).not.toMatch(/gradient\(/);
    expect(block).not.toMatch(/blur\(/);
    expect(light["--ae-glass-shadow"]).toBe("none");
    expect(dark["--ae-glass-shadow"]).toBe("none");
    expect(light["--ae-glass-blur"]).toBe("none");
  });

  it("has no drop shadow at all - the dialog lifts off the page by its backdrop and a stronger hairline", () => {
    const shadows = [...block.matchAll(/box-shadow:\s*([^;]+);/g)]
      .map((m) => m[1].replace("!important", "").trim())
      .filter((v) => v !== "none" && !v.startsWith("inset"));
    expect(shadows).toEqual([]);
    // The dialog sets its shadow, gradient and radius inline, so the theme must win with !important.
    const modal = rule(":root[data-ui=\"minimal\"] .ae-modal-panel");
    expect(modal).toMatch(/box-shadow:\s*none\s*!important/);
    expect(modal).toMatch(/background:\s*var\(--ae-surface\)\s*!important/);
  });

  it("uses one corner radius, set by a token, on areas, controls and the dialog", () => {
    expect(light["--ae-mini-radius"]).toBeDefined();
    expect(dark["--ae-mini-radius"]).toBe(light["--ae-mini-radius"]);
    const radii = [...block.matchAll(/border-radius:\s*([^;]+);/g)].map((m) => m[1].replace("!important", "").trim()).filter((v) => v !== "0");
    for (const r of radii) expect(r).toBe("var(--ae-mini-radius)");
  });

  it("keeps table column names on the same muted-to-ink scale in dark mode (no hard-coded white)", () => {
    expect(block).not.toMatch(/\.ae-table th[^{]*\{[^}]*color:\s*#fff/i);
  });

  it("draws the current tab as a 2px rule and keeps the watermark to a trace", () => {
    expect(block).toMatch(/\.ae-header-tabs-bar,[^{]*\{[^}]*height:\s*2px/);
    const shell = (selector: string) => Number(rule(selector).match(/--ae-watermark-opacity:\s*([\d.]+)/)![1]);
    expect(shell(':root[data-ui="minimal"] .app-shell')).toBeLessThanOrEqual(0.1);
    expect(shell(':root[data-ui="minimal"][data-theme="dark"] .app-shell')).toBeLessThanOrEqual(0.15);
  });

  it("does not rely on colour alone for the offline and negative-stock warnings", () => {
    expect(rule(':root[data-ui="minimal"] .ae-page-header.ae-page-header--offline')).toMatch(/inset 0 -1px 0 var\(--ae-danger-text\)/);
    expect(rule(':root[data-ui="minimal"] .ae-entry-total--bad .ae-entry-total-value')).toContain("underline");
  });

  it("keeps the emblem watermark (quieter) and removes the grid's alternating column tint", () => {
    expect(block).not.toContain(':root[data-ui="minimal"] .app-shell::before'); // not hidden: the base rule shows it
    expect(rule(':root[data-ui="minimal"] .app-shell')).toContain("--ae-watermark-opacity");
    for (const t of [light, dark]) {
      expect(t["--ae-col-a"]).toBe(t["--ae-col-b"]);
      expect(t["--ae-colh-a"]).toBe(t["--ae-colh-b"]);
    }
  });

  it("keeps an unreachable server unmistakable even with no header fill", () => {
    expect(rule(':root[data-ui="minimal"] .ae-page-header.ae-page-header--offline')).toContain("var(--ae-danger-text)");
  });
});
