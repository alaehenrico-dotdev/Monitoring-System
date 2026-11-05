// Browser tests (npm run e2e:browser). Two specs live in e2e-browser/:
//   themes.spec.mjs  every theme x light/dark, with the API mocked: needs only the built
//                    client (served by `vite preview`), no database, so it runs anywhere.
//   smoke.spec.mjs   the real stack (API + database): sign in, open every page, check the
//                    live connection and the loading beam. Runs only with E2E_REAL=1, which
//                    the CI "end-to-end" job sets after seeding its disposable database.
//
// Browser: Playwright's own Chromium by default (CI: `npx playwright install chromium`).
// To use one already on the machine instead, set E2E_BROWSER_CHANNEL=msedge (or chrome).
import { defineConfig } from "@playwright/test";

const real = process.env.E2E_REAL === "1";
const channel = process.env.E2E_BROWSER_CHANNEL || undefined;
// The production build, not the dev server: the dev server compiles each page on first visit,
// which made parallel runs slow and flaky, and the build is what actually ships. Its own port,
// so it never collides with a `npm run dev` that is already running on 5173.
const PORT = 4173;

export default defineConfig({
  testDir: "./e2e-browser",
  testMatch: "**/*.spec.mjs",
  outputDir: "./e2e-browser/results",
  timeout: 90_000,
  expect: { timeout: 20_000 },
  fullyParallel: true,
  // A page loads the whole app each time, so a few workers share the one preview server well;
  // more only made first loads slow enough to time out.
  workers: 3,
  // One retry: the first page loads on a cold machine can be slow enough to miss a timeout.
  retries: 1,
  reporter: process.env.CI ? [["list"], ["html", { open: "never", outputFolder: "e2e-browser/report" }]] : "list",
  use: {
    baseURL: `http://localhost:${PORT}`,
    channel,
    viewport: { width: 1440, height: 900 },
    // The built app registers its service worker, and requests the worker makes never pass
    // through page.route - so the mocked API would be bypassed and the real one hit.
    serviceWorkers: "block",
    trace: "retain-on-failure",
  },
  webServer: [
    ...(real
      ? [
          {
            // The built API, started the way production starts it.
            command: "npm run start --workspace server",
            url: "http://127.0.0.1:4000/health/live",
            reuseExistingServer: !process.env.CI,
            timeout: 60_000,
          },
        ]
      : []),
    {
      command: `npm run build --workspace client && npm run preview --workspace client -- --port ${PORT}`,
      url: `http://localhost:${PORT}`,
      reuseExistingServer: !process.env.CI,
      timeout: 180_000,
    },
  ],
});
