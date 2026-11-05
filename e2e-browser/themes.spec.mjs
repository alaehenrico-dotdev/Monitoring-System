// Every theme in light and dark, on the main pages, with the API mocked - so it needs no
// database. It screenshots each one (e2e-browser/screenshots, uploaded by CI) and checks the
// things a theme change tends to break: the page still renders, nothing scrolls sideways,
// and - for Studio - the tab strip stays exactly where it is on every page.
import { mkdirSync } from "node:fs";
import { expect, test } from "@playwright/test";
import { MODES, MOCKED_PAGES, THEMES, collectProblems, hashUrl, mockApi } from "./helpers.mjs";

const SHOTS = "e2e-browser/screenshots";
mkdirSync(SHOTS, { recursive: true });

async function signedInWithMockedApi(page, ui, mode) {
  await page.addInitScript(
    ([u, m]) => {
      localStorage.setItem("ala-eh-token", "mock-token");
      localStorage.setItem("ae-ui", u);
      localStorage.setItem("ae-theme", m);
    },
    [ui, mode],
  );
  await mockApi(page);
}

// One test per theme, mode and page: a page that is slow to load on a cold machine (the
// router holds the old screen until the new page's code arrives) fails alone, not the rest.
for (const ui of THEMES) {
  for (const mode of MODES) {
    for (const [path, title] of MOCKED_PAGES) {
      test(`${ui} / ${mode} / ${path}: renders with a header and tab strip, no sideways scroll`, async ({ page }) => {
        await signedInWithMockedApi(page, ui, mode);
        const problems = collectProblems(page);
        await page.goto(hashUrl(path));
        await expect(page.locator(".ae-page-header"), "header").toBeVisible();
        await expect(page.locator(".ae-header-tabs"), "tab strip").toBeVisible();
        await expect(page, "tab title").toHaveTitle(title);
        const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
        expect(overflow, `scrolls sideways by ${overflow}px`).toBeLessThanOrEqual(0);
        await page.screenshot({ path: `${SHOTS}/${ui}-${mode}-${path.slice(1)}.png` });
        expect(problems).toEqual([]);
      });
    }
  }
}

test.describe("Studio layout", () => {
  for (const mode of MODES) {
    test(`keeps the tab strip in the same place on every page (${mode})`, async ({ page }) => {
      await signedInWithMockedApi(page, "studio", mode);
      const tops = [];
      for (const [path] of MOCKED_PAGES) {
        await page.goto(hashUrl(path));
        await expect(page.locator(".ae-page-header"), `${path}: header`).toBeVisible();
        await expect(page.locator(".ae-header-tabs"), `${path}: tab strip`).toBeVisible();
        await page.waitForLoadState("networkidle");
        // Read it once the layout has stopped moving: two equal readings in a row.
        let last = -1;
        await expect
          .poll(async () => {
            const top = await page.locator(".ae-header-tabs").evaluate((el) => Math.round(el.getBoundingClientRect().top * 2) / 2);
            const settled = top === last && top > 0;
            last = top;
            return settled;
          }, { message: `${path}: tab strip never settled` })
          .toBe(true);
        tops.push([path, last]);
      }
      const unique = new Set(tops.map(([, top]) => top));
      expect(unique.size, `tab strip top differs between pages: ${JSON.stringify(tops)}`).toBe(1);
    });

    test(`puts the tab strip BELOW the header and outlines the current tab (${mode})`, async ({ page }) => {
      await signedInWithMockedApi(page, "studio", mode);
      await page.goto(hashUrl("/online"));
      const header = await page.locator(".ae-page-header").boundingBox();
      const tabs = await page.locator(".ae-header-tabs").boundingBox();
      expect(tabs.y).toBeGreaterThanOrEqual(header.y + header.height - 1);
      const bar = page.locator(".ae-header-tabs-bar");
      await expect(bar).toHaveCSS("border-top-style", "solid");
      await expect(bar).toHaveCSS("border-bottom-width", "0px");
    });

    test(`shows the full gold frame to the bottom of the screen, even on an empty page (${mode})`, async ({ page }) => {
      await signedInWithMockedApi(page, "studio", mode);
      await page.goto(hashUrl("/daily-out"));
      await expect(page.locator(".ae-header-tabs")).toBeVisible();
      const frame = await page.locator(".ae-main").evaluate((el) => {
        const cs = getComputedStyle(el, "::after");
        return { position: cs.position, left: cs.borderLeftWidth, bottom: cs.borderBottomWidth, top: cs.borderTopWidth, edge: cs.bottom };
      });
      expect(frame).toEqual({ position: "fixed", left: "1px", bottom: "1px", top: "0px", edge: "8px" });
    });
  }
});
