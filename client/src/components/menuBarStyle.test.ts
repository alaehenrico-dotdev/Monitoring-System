import { readFileSync } from "node:fs";
import { readAllCss } from "../test-utils/css";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// The menu-bar toolbar's style rules live in CSS, which jsdom does not apply, so
// these guard the stylesheet and the components' source: the spec's rules about
// tokens, targets and tiers must stay true as the code changes.
const css = readAllCss(join(__dirname, "../index.css"));
// Ends where the Classic Plus theme begins: later theme blocks restyle these
// controls on purpose and are not part of the menu bar's own spec.
const blockStart = css.indexOf("Menu-bar toolbar (components/EntryToolbar.tsx");
const block = css.slice(blockStart, css.indexOf("Classic Plus theme (Settings", blockStart));
const source = (name: string) => readFileSync(join(__dirname, name), "utf8");
const COMPONENTS = ["MenuBar.tsx", "SplitButton.tsx", "SaveStatus.tsx", "DateStepper.tsx", "FilterSlot.tsx", "EntryToolbar.tsx", "PageToolbar.tsx"];

describe("menu-bar toolbar style", () => {
  it("hard-codes no colour in any component: every colour is a token in the stylesheet", () => {
    for (const name of COMPONENTS) {
      expect(source(name), name).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
      expect(source(name), name).not.toMatch(/\brgba?\(/);
    }
  });

  it("defines its colours, radius and sizes as tokens, with a dark value for the amber", () => {
    for (const token of ["--ae-mb-radius: 4px", "--ae-mb-h: 28px", "--ae-mb-gap: 6px", "--ae-mb-line-w: 1px", "--ae-mb-menu-bg", "--ae-mb-primary-bg", "--ae-mb-warn"]) {
      expect(block, token).toContain(token);
    }
    expect(block).toMatch(/:root\[data-theme="dark"\] \.ae-mb[^{]*\{[^}]*--ae-mb-warn:/);
    expect(block).toMatch(/:root\[data-theme="dark"\]\s*\{[^}]*--ae-mb-menu-shadow/);
  });

  it("keeps every control at least 28px tall, and larger for touch", () => {
    expect(block).toMatch(/\.ae-mb-btn,\s*\.ae-mb-trigger\s*\{[^}]*min-height: 28px/);
    expect(block).toMatch(/@media \(pointer: coarse\)\s*\{\s*\.ae-mb\s*\{\s*--ae-mb-h: 40px/);
  });

  it("uses a single radius and no shadow except on the open menu", () => {
    expect(block.match(/box-shadow:/g)?.length ?? 0).toBe(2); // the active-filter underline and the menu
    expect(block).toMatch(/\.ae-mb-menu\s*\{[^}]*box-shadow: var\(--ae-mb-menu-shadow\)/);
    expect(block).not.toMatch(/border-radius:\s*\d+px/); // always the token (or a calc from it)
  });

  it("shows a visible focus ring on every control, from the accent token", () => {
    expect(block).toMatch(/\.ae-mb-btn:focus-visible[^{]*\{[^}]*outline: 2px solid var\(--ae-mb-accent\)/);
    expect(block).toMatch(/\.ae-mb-item:focus-visible\s*\{[^}]*outline: 2px solid var\(--ae-mb-menu-focus\)/);
  });

  it("never signals a state by colour alone: disabled is dashed and dimmed, an active filter has a dot", () => {
    expect(block).toMatch(/\.ae-mb-btn\[aria-disabled="true"\]\s*\{[^}]*border-style: dashed/);
    expect(block).toMatch(/\.ae-filter-dot\s*\{[^}]*border-radius: 50%/);
  });

  it("draws the open search box with a hairline at half the bar's border weight", () => {
    expect(block).toMatch(/\.ae-mb \.ae-search--open input\[type="search"\]\s*\{[^}]*border: calc\(var\(--ae-mb-line-w\) \* 0\.5\) solid var\(--ae-mb-line\)/);
  });

  it("lets the other pages' filters wrap instead of disappearing", () => {
    expect(block).toMatch(/\.ae-mb--page\s*\{[^}]*flex-wrap: wrap/);
    expect(block).toMatch(/\.ae-mb--page \.ae-mb-filters\s*\{[^}]*flex-wrap: wrap/);
  });

  it("steps down in three tiers by the bar's own width: wide, medium chips, narrow overflow", () => {
    expect(block).toMatch(/container-type: inline-size/);
    expect(block).toMatch(/@container ae-mb \(max-width: 1700px\)/);
    expect(block).toMatch(/@container ae-mb \(max-width: 1100px\)[^}]*\{[^}]*\.ae-mb-menus/);
    // The menus really go at narrow widths: the shared toolbar rule that makes a
    // toolbar's first child display:flex out-specifies a plain display:none.
    expect(block).toMatch(/\.ae-mb-menus\s*\{\s*display: none !important/);
    // And a phone keeps search, the date and Save on one row.
    expect(block).toMatch(/@container ae-mb \(max-width: 660px\)[^}]*\{\s*\.ae-datestep-today\s*\{\s*display: none/);
    // Narrow shows the overflow menu and hides what it replaces.
    expect(block).toMatch(/\.ae-mb-overflow\s*\{\s*display: inline-flex/);
  });
});
