import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { readAllCss } from "./test-utils/css";

const css = readAllCss(join(__dirname, "index.css"));
const studio = css.slice(css.indexOf("Studio theme (Settings"));

describe("Studio theme stylesheet", () => {
  it("moves the tab strip below the header card with flex order, not markup", () => {
    expect(studio).toMatch(/\.ae-sticky-head \{[^}]*flex-direction: column/);
    expect(studio).toMatch(/\.ae-sticky-head > \.ae-page-header \{[^}]*order: 1/);
    expect(studio).toMatch(/\.ae-sticky-head > \.ae-header-tabs \{[^}]*order: 2/);
  });

  it("draws the current tab as the sliding bar: gold on three sides, open at the bottom", () => {
    const rule = studio.slice(studio.indexOf(".ae-header-tabs-bar {"));
    const body = rule.slice(0, rule.indexOf("}"));
    expect(body).toContain("border: 1px solid var(--ae-st-gold)");
    expect(body).toContain("border-bottom: 0");
    expect(body).toContain("bottom: 0");
  });

  it("flares the outline into the strip's rule with a curved foot on each side", () => {
    expect(studio).toMatch(/\.ae-header-tabs-bar::before \{[^}]*radial-gradient\(circle at 0 0/);
    expect(studio).toMatch(/\.ae-header-tabs-bar::after \{[^}]*radial-gradient\(circle at 100% 0/);
  });

  it("defines light and dark token sets with a gold accent in each", () => {
    expect(studio).toMatch(/\[data-ui="studio"\]:not\(\[data-theme="dark"\]\) \{[^}]*--ae-st-gold/);
    expect(studio).toMatch(/\[data-ui="studio"\]\[data-theme="dark"\] \{[^}]*--ae-st-gold/);
  });

  it("is loaded after menu-bar.css so its header and tab rules win", () => {
    expect(css.indexOf("Studio theme (Settings")).toBeGreaterThan(css.indexOf("Menu-bar toolbar (components/EntryToolbar.tsx"));
  });

  it("no removed theme is left in the stylesheet", () => {
    expect(css).not.toMatch(/data-ui="(enterprise|flat|aurora|halloween|plus)"/);
  });
});

describe("Studio header height", () => {
  it("is one fixed minimum height on every page, centred, with no collapse button", () => {
    expect(studio).toMatch(/\.ae-page-header \{[^}]*--ae-st-head-h: calc\(110px[^}]*min-height: var\(--ae-st-head-h\)/);
    expect(studio).toMatch(/\.ae-page-header \{[^}]*justify-content: center/);
    expect(studio).toMatch(/\.ae-page-header-collapse-btn \{\s*display: none/);
  });
});

describe("Studio page frame", () => {
  it("draws one fixed gold frame from the pinned header to the screen bottom, with 4px bottom corners", () => {
    const rule = studio.slice(studio.indexOf(".ae-main::after {"));
    const body = rule.slice(0, rule.indexOf("}"));
    expect(body).toContain("position: fixed");
    expect(body).toContain("--ae-head-bottom");
    expect(body).toContain("border: 1px solid var(--ae-st-gold)");
    expect(body).toContain("border-radius: 0 0 4px 4px");
  });

  it("rounds the top corners to 4px with real borders, under the strip's two ends", () => {
    expect(studio).toMatch(/\.ae-sticky-head::before \{[^}]*border-top-left-radius: 4px/);
    expect(studio).toMatch(/\.ae-sticky-head::after \{[^}]*border-top-right-radius: 4px/);
  });

  it("stops the strip's own rule 4px short at each end, where those corners take over", () => {
    expect(studio).toContain("4px 100% / calc(100% - 8px) 1px no-repeat");
  });

  it("closes the gap under the header on grid pages and lets the frame draw the table's edge", () => {
    expect(studio).toMatch(/\.ae-sticky-head:has\(\+ \.ae-grid-fill\) \{\s*margin-bottom: 0/);
  });
});
