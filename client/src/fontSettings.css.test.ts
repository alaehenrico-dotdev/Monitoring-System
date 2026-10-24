import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// Guards on the stylesheet itself (jsdom applies no CSS): the font settings
// promise that the text size scales the interface but never the data tables,
// whose header and row heights are fixed numbers elsewhere in the code.
const css = readFileSync(join(__dirname, "index.css"), "utf8");
const rule = (selector: string): string => {
  const at = css.indexOf(selector + " {");
  if (at < 0) throw new Error(`rule not found: ${selector}`);
  return css.slice(at, css.indexOf("}", at));
};

describe("font settings stylesheet", () => {
  it("keeps the data tables at a fixed size so their row and header heights hold", () => {
    expect(rule(".ae-table")).toMatch(/font-size: 13px;/);
    expect(rule(".ae-table th")).toMatch(/font-size: 11.5px;/);
    expect(rule(".ae-input.ae-input-cell")).toMatch(/font-size: 13px;/);
    expect(rule(".ae-cat-toggle")).toMatch(/font-size: 12px;/);
  });

  it("scales the interface text by the text-size multiplier", () => {
    expect(rule(".ae-btn")).toContain("calc(13px * var(--ae-fs, 1))");
    expect(rule(".ae-toast-message")).toContain("var(--ae-fs, 1)");
    expect(css).toMatch(/html \{\s*font-size: calc\(100% \* var\(--ae-fs, 1\)\);/);
  });

  it("defines a scale for every size step and a face for every typeface", () => {
    for (const size of ["sm", "lg", "xl"]) expect(css).toContain(`:root[data-fs="${size}"]`);
    for (const font of ["hyperlegible", "plex", "system", "serif", "mono"]) expect(css).toContain(`:root[data-font="${font}"]`);
    expect(css).toMatch(/:root \{\s*--ae-font-body: "Inter"/);
  });

  it("sets the typeface once, through the variable, instead of naming Inter in each rule", () => {
    expect(css.match(/font-family:\s*"Inter"/g)).toBeNull();
    expect(rule("body")).toContain("font-family: var(--ae-font-body)");
  });
});
