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

  it("allows one soft shadow only - on the dialog that has to lift off the page", () => {
    const shadows = [...block.matchAll(/box-shadow:\s*([^;]+);/g)].map((m) => m[1].trim()).filter((v) => v !== "none" && !v.startsWith("inset"));
    expect(shadows).toHaveLength(1);
    expect(rule(":root[data-ui=\"minimal\"] .ae-modal-panel")).toContain(shadows[0]);
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
