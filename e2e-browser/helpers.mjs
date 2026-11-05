// Shared by the browser specs.

/// Every page a signed-in administrator can reach from the tab strip, with the
/// tab title it sets (client/src/hooks/useDocumentTitle.ts).
export const PAGES = [
  ["/dashboard", /Dashboard/],
  ["/online", /Online Entry/],
  ["/offline", /Offline Entry/],
  ["/manual-count", /Manual Count/],
  ["/total-stocks", /Total Stocks/],
  ["/daily-out", /Daily Out/],
  ["/daily-report", /Daily Report/],
  ["/corrections", /Corrections/],
  ["/settings", /Settings/],
];

/// The pages that render with only the canned answers below (the rest, e.g. Admin Queue and
/// Settings, expect real data shapes and are covered by the real-stack smoke test instead).
export const MOCKED_PAGES = PAGES.filter(([path]) => ["/online", "/offline", "/total-stocks", "/daily-out", "/daily-report"].includes(path));

/// The themes (Settings > Appearance) as stored under the `ae-ui` key.
export const THEMES = ["classic", "brutal", "glass", "minimal", "skeuo", "studio"];
export const MODES = ["light", "dark"];

/// Console noise that is not a defect of the app: the dev proxy cannot reach an API that
/// is deliberately absent in the mocked run, and browsers log failed WebSocket attempts.
const IGNORED_CONSOLE = [/WebSocket connection/i, /Failed to load resource/i, /ERR_CONNECTION_REFUSED/i, /\/ws/];

/// What goes wrong while a page is open: uncaught exceptions and console errors.
export function collectProblems(page) {
  const problems = [];
  page.on("pageerror", (e) => problems.push(`exception: ${e.message}`));
  page.on("console", (m) => {
    if (m.type() !== "error") return;
    const text = m.text();
    if (IGNORED_CONSOLE.some((re) => re.test(text))) return;
    problems.push(`console: ${text}`);
  });
  return problems;
}

/// The hash route a path lives at (the app uses a HashRouter).
export const hashUrl = (path) => `/#${path}`;

const ADMIN = { id: 1, username: "admin", name: "Administrator", role: "SUPERVISOR_ADMIN", mustChangePassword: false, mfaEnabled: false };

/// Canned answers for the API paths the main pages ask for on load. Anything not listed
/// gets an empty list, which the list-shaped endpoints accept; a page that crashes on
/// another shape is a sign a mock is missing here, not that the page is broken.
const MOCKS = {
  "/api/auth/me": ADMIN,
  "/api/app-settings/shift-mode": { useShifts: true },
  "/api/day-closures/status": {
    entryDate: "2026-11-05", shift: "MORNING", isClosed: false, locked: false, onlineLocked: false, offlineLocked: false,
    closure: null, blockedBy: null, entryBlockedBy: null,
  },
  "/api/day-closures/finish-summary": {
    online: { saved: 0, total: 0 }, offline: { saved: 0, total: 0 }, onlineLocked: false, offlineLocked: false,
    alreadyFinished: false, negatives: [],
  },
};

/// Answers every /api/ request from MOCKS, so a page can render with no server and no
/// database. Only the API's own paths: Vite also serves source files under /src/api/.
export async function mockApi(page) {
  await page.route((url) => url.pathname.startsWith("/api/"), (route) => {
    const { pathname } = new URL(route.request().url());
    return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(MOCKS[pathname] ?? []) });
  });
}
