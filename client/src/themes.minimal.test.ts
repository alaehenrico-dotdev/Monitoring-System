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
    // Each corner is a token or square (a tab rounds only its top corners: "token token 0 0"). The sub-page tab
    // outline uses its own 4px token so that tabs, feet and frame are one curve (see the next tests).
    for (const r of radii) for (const corner of r.split(/\s+/)) expect(["var(--ae-mini-radius)", "var(--ae-mini-tab-radius)", "0"]).toContain(corner);
    expect(light["--ae-mini-tab-radius"]).toBe("4px");
    expect(dark["--ae-mini-tab-radius"]).toBe("4px");
    expect(radii.length).toBeGreaterThan(5);
  });

  it("shows column names at full contrast - white in dark mode, near-black in light - through one token", () => {
    expect(light["--ae-mini-colhead"]).toBeDefined();
    expect(dark["--ae-mini-colhead"]).toBe("#ffffff");
    for (const t of [light, dark]) expect(contrast(t["--ae-mini-colhead"], t["--ae-bg"])).toBeGreaterThanOrEqual(7);
    // The header rule reads the token (no colour typed into it), including what sits inside a header
    // and Daily Out's second header row, which the other themes mute.
    expect(rule(':root[data-ui="minimal"] .ae-table th')).toContain("color: var(--ae-mini-colhead)");
    expect(block).toMatch(/\.ae-table th \*,[\s\S]*?thead tr:nth-child\(2\) th \{\s*color: var\(--ae-mini-colhead\)/);
  });

  it("draws the current tab as a 2px rule and keeps the watermark to a trace", () => {
    expect(block).toMatch(/\.ae-header-tabs-bar,[^{]*\{[^}]*height:\s*2px/);
    const shell = (selector: string) => Number(rule(selector).match(/--ae-watermark-opacity:\s*([\d.]+)/)![1]);
    expect(shell(':root[data-ui="minimal"] .app-shell')).toBeLessThanOrEqual(0.1);
    expect(shell(':root[data-ui="minimal"][data-theme="dark"] .app-shell')).toBeLessThanOrEqual(0.15);
  });

  it("draws the current sub-page tab's boxed outline as ONE path, coloured here and nowhere else", () => {
    const strip = ':root[data-ui="minimal"] .ae-subtabs--framed';
    // The outline is a single SVG path (components/SubTabPanel.tsx): shown in this theme only (base.css hides it
    // everywhere else) and coloured by the theme's ink. It is not assembled from CSS borders, gradients or shadows,
    // whose separate pieces never joined exactly at fractional display scaling.
    const outline = rule(':root[data-ui="minimal"] .ae-subtab-outline');
    expect(outline).toContain("display: block");
    expect(outline).toContain("position: absolute");
    expect(outline).toContain("overflow: visible"); // it reaches above the content box, over the strip
    expect(outline).toContain("pointer-events: none");
    expect(rule(':root[data-ui="minimal"] .ae-subtab-outline path')).toContain("stroke: var(--ae-mini-ink)");
    // The tabs and the frame draw no line of their own: no border, shadow or gradient on any of them.
    const tabSection = block.slice(block.indexOf("Sub-page tabs (Settings"), block.indexOf("Areas: no fill"));
    expect(tabSection).not.toMatch(/gradient\(/);
    expect(tabSection).not.toMatch(/box-shadow:\s*(?!none)/);
    expect(rule(`${strip} .ae-subtab`)).toMatch(/border:\s*0;/);
    expect(rule(`${strip} .ae-subtab[aria-selected="true"]:hover`)).not.toMatch(/border/);
    expect(rule(`${strip} + .ae-subtab-panel`)).not.toMatch(/border:|border-top|border-left/);
    expect(rule(`${strip} + .ae-subtab-panel`)).toContain("position: relative"); // the outline is positioned against it
    // Every tab is the same size, so the labels never move when the current tab changes.
    expect(rule(`${strip} .ae-subtab`)).toContain("padding: 8px 15px 9px");
    expect(rule(`${strip} .ae-subtab[aria-selected="true"]:hover`)).not.toContain("padding");
    expect(rule(strip)).toContain("margin-bottom: 0");
    expect(rule(`${strip} .ae-subtab::after`)).toContain("display: none"); // the other themes' underline
    // The tab's hover tint is rounded on top with the outline's radius, and !important: a global rule gives every
    // <button> a 4px radius on all four corners with !important.
    expect(rule(`${strip} .ae-subtab`)).toContain("border-radius: var(--ae-mini-tab-radius) var(--ae-mini-tab-radius) 0 0 !important");
    // The keyboard ring stays inside the tab so the strip's clipping cannot cut it off.
    expect(rule(`${strip} .ae-subtab:focus-visible`)).toMatch(/outline-offset:\s*-\d+px/);
  });

  it("gives the sub-page outline its own 4px radius token, in both colour modes", () => {
    // 4px outer on a 1px line = a 3.5px centre line; utils/subTabOutline.ts draws the corners with the same value.
    expect(light["--ae-mini-tab-radius"]).toBe("4px");
    expect(dark["--ae-mini-tab-radius"]).toBe("4px");
  });

  it("only boxes strips that have a content panel: a status filter in a toolbar row keeps its own look", () => {
    const subtabSelectors = [...block.matchAll(/(^|\n)(:root[^{]*)\{/g)].map((m) => m[2].trim()).filter((s) => /\.ae-subtabs?(?![\w-])/.test(s)); // the tab buttons and strips; not the panel or the outline
    expect(subtabSelectors.length).toBeGreaterThanOrEqual(4); // the tab, its hover, its current state and its focus ring
    for (const s of subtabSelectors) expect(s).toContain(".ae-subtabs--framed");
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
