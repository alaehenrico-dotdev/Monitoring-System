// The real stack (API + database), driven through a browser. Runs only with E2E_REAL=1 and the
// disposable E2E accounts seeded (the CI "end-to-end" job). It exists to catch what unit tests
// and the API script cannot: the page, the proxy, the WebSocket and the API working together.
import { expect, test } from "@playwright/test";
import { PAGES, collectProblems, hashUrl } from "./helpers.mjs";

test.skip(process.env.E2E_REAL !== "1", "needs the real stack: set E2E_REAL=1 (see playwright.config.mjs)");

const ADMIN_USER = process.env.E2E_ADMIN_USERNAME ?? "admin";

/// The seeded admin's forced password change is done once for the whole run, in global-setup.mjs
/// (doing it per worker invalidated the other workers' sessions). The session arrives here.
const session = process.env.E2E_SESSION ? JSON.parse(process.env.E2E_SESSION) : { token: "", user: null, password: "" };
test.beforeAll(() => {
  expect(session.token, "global-setup did not provide a session (is E2E_ADMIN_PASSWORD set?)").not.toBe("");
});

test("signing in through the form lands on the app", async ({ page }) => {
  const problems = collectProblems(page);
  await page.goto(hashUrl("/login"));
  await page.getByLabel("Username").fill(ADMIN_USER);
  await page.getByLabel("Password", { exact: true }).fill(session.password);
  await page.getByRole("button", { name: /sign in/i }).click();
  await expect(page.locator(".ae-page-header")).toBeVisible();
  await expect(page.locator(".ae-header-tabs")).toBeVisible();
  expect(problems).toEqual([]);
});

test.describe("signed in", () => {
  test.beforeEach(async ({ page }) => {
    await page.addInitScript((token) => localStorage.setItem("ala-eh-token", token), session.token);
  });

  for (const [path, title] of PAGES) {
    test(`${path} opens, sets its tab title and logs no errors`, async ({ page }) => {
      const problems = collectProblems(page);
      await page.goto(hashUrl(path));
      await expect(page.locator(".ae-page-header")).toBeVisible();
      await expect(page).toHaveTitle(title);
      expect(problems).toEqual([]);
    });
  }

  test("the live connection opens, and the header beam does not stay on", async ({ page }) => {
    const socket = page.waitForEvent("websocket", (ws) => ws.url().endsWith("/ws"));
    await page.goto(hashUrl("/online"));
    await socket;
    // The beam is for a brief (re)connect or a slow request; stuck on is the bug this guards.
    await expect(page.locator(".ae-seal-beam")).toHaveAttribute("data-state", "idle", { timeout: 15_000 });
  });

  test("the API answers through the proxy the page uses", async ({ page }) => {
    await page.goto(hashUrl("/online"));
    const status = await page.evaluate(async () => (await fetch("/health")).status);
    expect(status).toBe(200);
  });
});
