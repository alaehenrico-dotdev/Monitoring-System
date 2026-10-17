import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// The interaction baseline lives in CSS, which jsdom does not apply, so this is a
// guard on the stylesheet itself: the rules every control inherits must stay.
const css = readFileSync(join(__dirname, "index.css"), "utf8");
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
