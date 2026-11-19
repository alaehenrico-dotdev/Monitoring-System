import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { readAllCss } from "./test-utils/css";

// jsdom applies no CSS, so this guards the stylesheet itself.
const css = readAllCss(join(__dirname, "index.css"));

describe("native dropdown options", () => {
  it("get an opaque background and a text colour that follow the colour scheme, so they are readable in every theme", () => {
    const rule = css.match(/\.ae-select option,\s*\.ae-select optgroup\s*\{([^}]*)\}/);
    expect(rule, "a rule for .ae-select option").not.toBeNull();
    expect(rule![1]).toMatch(/background-color:\s*Canvas/);
    expect(rule![1]).toMatch(/color:\s*CanvasText/);
  });

  it("keeps an unavailable option visibly dimmed", () => {
    expect(css).toMatch(/\.ae-select option:disabled\s*\{[^}]*color:\s*GrayText/);
  });
});
