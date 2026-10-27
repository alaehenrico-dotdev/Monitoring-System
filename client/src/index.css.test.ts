import { existsSync, readdirSync, readFileSync } from "node:fs";
import { readAllCss } from "./test-utils/css";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";

// The interaction baseline lives in CSS, which jsdom does not apply, so this is a
// guard on the stylesheet itself: the rules every control inherits must stay.
const css = readAllCss(join(__dirname, "index.css"));
const block = css.slice(css.indexOf("Interaction baseline"));

describe("interaction baseline (index.css)", () => {
  it("gives every interactive element a keyboard focus ring, without overriding components that have their own", () => {
    expect(block).toMatch(/:where\([^)]*button[^)]*\):focus-visible\s*\{[^}]*outline: 2px solid/);
  });

  it("shows a visible ring on keyboard focus for fields and selects, whose :focus rule removes the outline", () => {
    expect(css).toContain(".ae-input:not(.ae-input-cell):focus-visible");
    expect(css).toContain(".ae-select:focus-visible");
  });

  it("draws every focus ring from one high-contrast token, not the faint brand gold", () => {
    expect(css).toContain("--ae-focus-ring: #8a6800;");
    expect(css).toContain("--ae-focus-ring: #f5c000;");
    expect(block).toContain("outline: 2px solid var(--ae-focus-ring)");
  });

  it("removes the tap delay on controls", () => {
    expect(block).toMatch(/touch-action: manipulation/);
  });

  it("ends every transition at once for users who reduce motion", () => {
    const reduced = block.slice(block.indexOf("@media (prefers-reduced-motion: reduce)"));
    expect(reduced).toMatch(/transition-duration: 0\.01ms !important/);
    expect(reduced).toMatch(/scroll-behavior: auto !important/);
  });

  it("does not stop loaders: the baseline never touches animation-duration", () => {
    expect(block).not.toMatch(/animation-duration/);
  });

  it("never animates a layout property with transition: all", () => {
    expect(css).not.toMatch(/transition:\s*all\b/);
  });
});

describe("the emblem background", () => {
  it("is drawn from the Glossy Black emblem copies, and no theme hides it", () => {
    expect(css).toContain("emblem-wm-ink.webp");
    expect(css).toContain("emblem-wm-white.webp");
    // Every `.app-shell::before` rule (the watermark layer) must leave it visible;
    // the only `display: none` allowed is the print one, which is `!important`.
    for (const m of css.matchAll(/([^{}]*\.app-shell::before)\s*\{([^}]*)\}/g)) {
      const hidden = /display:\s*none(?!\s*!important)/.test(m[2]);
      expect(hidden, `a rule hides the emblem: ${m[1].trim()}`).toBe(false);
    }
  });

  it("every theme that tunes the watermark opacity keeps it visible (above zero)", () => {
    for (const m of css.matchAll(/--ae-watermark-opacity:\s*([\d.]+)/g)) {
      expect(Number(m[1])).toBeGreaterThan(0);
    }
  });
});

describe("every url() in the stylesheets points at a file that exists", () => {
  // Paths in url() resolve from the CSS file itself, so moving rules between
  // files (e.g. out of index.css into styles/) silently breaks them: the build
  // only warns, and the image just never loads.
  const dirs = [join(__dirname, "styles"), join(__dirname, "styles", "themes"), __dirname];
  const cssFiles = dirs.flatMap((d) => readdirSync(d).filter((f) => f.endsWith(".css")).map((f) => join(d, f)));

  it("finds the stylesheets", () => {
    expect(cssFiles.length).toBeGreaterThan(10);
  });

  for (const file of cssFiles) {
    it(`${file.slice(__dirname.length + 1)}`, () => {
      const text = readFileSync(file, "utf8");
      for (const m of text.matchAll(/url\(\s*["']?([^"')]+)["']?\s*\)/g)) {
        const ref = m[1];
        if (/^(data:|https?:|\/|#)/.test(ref)) continue; // inline, remote, public/ or fragment
        expect(existsSync(join(dirname(file), ref.split(/[?#]/)[0])), `${ref} does not exist next to ${file}`).toBe(true);
      }
    });
  }
});

describe("round buttons, the oval clock and the seal's loading beam", () => {
  const rule = (selector: string) => {
    const at = css.indexOf(selector + " {");
    expect(at, `rule not found: ${selector}`).toBeGreaterThan(-1);
    return css.slice(at, css.indexOf("}", at));
  };

  it("a .ae-round button is a circle, and the rule out-ranks the global 4px button radius", () => {
    const body = rule(".ae-round.ae-round.ae-round.ae-round");
    expect(body).toContain("border-radius: 50% !important");
    // The 4px rule is !important too, so only specificity can beat it: four classes > its three :not()s plus a tag.
    expect(css).toMatch(/button:not\(\.ae-page-header-logo\)[\s\S]*?border-radius: 4px !important/);
  });

  it("an icon-only menu (the ... menu) and the compact icon-only Clear filters button are circles", () => {
    expect(rule(".ae-mb-trigger--icon.ae-mb-trigger--icon.ae-mb-trigger--icon.ae-mb-trigger--icon")).toContain("border-radius: 50% !important");
    expect(rule(".ae-clear-filters.ae-clear-filters.ae-clear-filters.ae-clear-filters")).toContain("border-radius: 50% !important");
  });

  it("the date arrows stay square: they sit in a joined group, where a circle would not fit", () => {
    expect(css).not.toMatch(/\.ae-mb-btn--icon\.ae-mb-btn--icon[^{]*\{[^}]*50%/);
  });

  it("the clock is an oval once the window is narrow enough for the compact toolbar, and only then", () => {
    const at = css.indexOf("@media (max-width: 1800px) {\n  .ae-live-clock");
    expect(at).toBeGreaterThan(-1);
    const block = css.slice(at, css.indexOf("\n}\n", at));
    expect(block).toContain("border-radius: 999px !important");
    // Outside that media query the clock keeps its component's own rounded-rectangle shape.
    const outside = css.slice(0, at) + css.slice(at + block.length);
    expect(outside).not.toMatch(/\.ae-live-clock[^{]*\{[^}]*999px/);
  });

  it("the seal's beam is hidden and paused when idle, amber and slower when slow or reconnecting", () => {
    expect(rule(".ae-seal-beam")).toContain("opacity: 0");
    expect(rule(".ae-seal-beam.is-idle .ae-logo-orbit")).toContain("animation-play-state: paused");
    expect(css).toMatch(/\.ae-seal-beam\.is-busy,\s*\.ae-seal-beam\.is-slow,\s*\.ae-seal-beam\.is-connecting\s*\{\s*opacity: 1/);
    expect(css).toMatch(/\.ae-seal-beam\.is-slow,\s*\.ae-seal-beam\.is-connecting\s*\{\s*--ring: #f08a24/);
    expect(css).toMatch(/\.ae-seal-beam\.is-slow \.ae-logo-orbit,\s*\.ae-seal-beam\.is-connecting \.ae-logo-orbit\s*\{\s*animation-duration: 2\.4s/);
  });

  it("the seal button is positioned, so the beam sits over it, and the beam is not printed", () => {
    expect(rule(".ae-page-header-logo")).toContain("position: relative");
    expect(css).toMatch(/@media print \{\s*\.ae-seal-beam \{\s*display: none/);
  });
});

describe("keyboard focus stays visible on the sub-tabs", () => {
  it("a focused sub-tab gets an outline ring, in addition to the underline", () => {
    const at = css.indexOf(".ae-subtab:focus-visible {");
    expect(at).toBeGreaterThan(-1);
    const body = css.slice(at, css.indexOf("}", at));
    expect(body).toMatch(/outline:\s*2px solid/);
    expect(body).not.toMatch(/outline:\s*none/);
  });
});
