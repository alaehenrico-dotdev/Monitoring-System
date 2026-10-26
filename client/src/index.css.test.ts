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
