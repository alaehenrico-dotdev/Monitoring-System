# Backend Debug Findings Report

**Project:** Ala Eh Stocks Monitoring System (Express/Prisma/MySQL API, React client)
**Scope:** stock entry, carry-forward, day/month locking, corrections and frozen reports, awaiting release, product merge, health and error handling, dependency advisories, repository hygiene (`.gitignore`), and the focus/loading behavior of the client.
**Last updated:** 2026-10-17
**Investigator:** Claude
**Progress:** Complete with remaining risks

## Summary

| Severity | Open | In progress | Fixed (not verified) | Fixed (verified) | Accepted risk | Blocked | Not reproducible |
|---|---|---|---|---|---|---|---|
| Critical | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| High | 0 | 0 | 0 | 3 | 1 | 1 | 0 |
| Medium | 0 | 0 | 2 | 3 | 0 | 0 | 0 |
| Low | 1 | 0 | 1 | 2 | 1 | 0 | 1 |

Eleven findings are fixed. The most important open item is **F-012**: the local MySQL rejects the login in `server/.env`, so nothing has been exercised against a live database. Every "verified" below means a unit or build check passed; none of it has run against a real MySQL yet. The CI end-to-end job is the first place the new migration will run.

## Scope and coverage

- **Examined:** `server/src` (services, routes, controllers, middleware, `app.ts`, `server.ts`), `server/prisma` (schema, new migration), `client/src` (layout, tables, toolbar, settings, theme/CSS), `.gitignore`, git history for committed secrets, `docker-compose.yml`, `server/Dockerfile`, `.github/workflows`, `ecosystem.config.cjs`, `PRODUCTION.md` headings, `scripts/e2e.mjs`, `npm audit --omit=dev`.
- **Not examined / not provided:** a running database or server (login rejected, see F-012); the live production host, its nginx and cron; a backup restore; query plans or performance under real data; alert delivery to Slack; browsers or real devices (CSS behavior is reasoned from the stylesheet, plus one static test page).
- **Assumptions:** the business-date rule is "Morning then Night, Night belongs to the date it started"; the Windows file lock seen during `npm install` was a running dev server (the process was not identified).
- **Environment for verification:** local Windows, Node 24, Vitest. Server: `npx vitest run` in `server/`. Client: `npx tsc -b`, `npx vitest run`, `npx vite build` in `client/`.

## Findings

### F-001: Correcting a Morning row did not update the same day's Night opening
- **Severity:** High (wrong stock figures carried into the next shift)
- **Area:** code (carry-forward)
- **Source:** code review
- **Status:** Fixed (verified)
- **Location:** `server/src/services/manualCounts.service.ts` `propagateOpeningStock`; callers in `dailyOnlineStock.service.ts`, `dailyOfflineStock.service.ts`

**Reproduction and evidence**
New test `carryForwardShift.test.ts` saved Morning (remaining 80) and Night (opening 80), then corrected Morning to 180. Before the fix: `expected 80 to be 180` for both Online and Offline.

**Root cause**
The forward walk always started past that date's Night shift (correct for a count, which opens the next day), but entry saves passed their own shift and it was ignored.

**Fix**
The walk now takes a start option; entry saves start at their own period.

**Verification**
- Command run: `cd server && npx vitest run`
- Result: 446 passed; the new shift-aware tests failed before the fix, passed after.
- Regression test: `carryForwardShift.test.ts`
- Date verified: 2026-10-17

**Remaining risk**
Covered by a test double of the repositories, not a real database.

### F-002: Approving a correction left the frozen Daily Report stale
- **Severity:** High (a finished day's report kept figures its ledger no longer had)
- **Area:** code
- **Source:** code review
- **Status:** Fixed (verified)
- **Location:** `server/src/services/correction.service.ts`, new `snapshotRefresh.service.ts`

**Reproduction and evidence**
`approveCorrection` applied the change through the normal save but never rebuilt the snapshot; `findFrozenSnapshot` serves a stored report while the day is locked (read in `dailyReportSnapshot.service.ts`).

**Root cause**
Snapshots were only written by "Finish day".

**Fix**
Approval refreshes the snapshot of every finished day it wrote to, skipping days whose report is unchanged (key-order-independent comparison, since MySQL JSON reorders keys).

**Verification**
- Command run: `cd server && npx vitest run`
- Result: 446 passed
- Regression test: `correction.service.test.ts`, `staleOpening.service.test.ts` (includes the comparison helper)
- Date verified: 2026-10-17

**Remaining risk**
Snapshot regeneration itself runs against mocks only; first real run is CI/staging.

### F-003: A late edit into a finished period aborted the whole save
- **Severity:** Medium (blocked legitimate late edits and count publishing)
- **Area:** code
- **Source:** code review
- **Status:** Fixed (verified)
- **Location:** `manualCounts.service.ts` (walk), new `staleOpening.service.ts`, `dayLock.service.ts`

**Reproduction and evidence**
The walk called `assertPeriodOpen` on each later row; a locked day threw and rolled back the user's edit.

**Root cause**
Carry-forward treated "a later day is finished" as an error on the edit that merely preceded it.

**Fix**
The save succeeds; the walk stops at the finished day and files a held "opening stock" correction request. Approving a correction covers only that figure unless the admin ticks "also apply to later finished days"; a closed month always needs its own approval.

**Verification**
- Command run: `cd server && npx vitest run`
- Result: 446 passed
- Regression test: `carryForwardShift.test.ts` (hold, approved-row cases), `dayLock.service.test.ts` (`isLockedForCarry`, month rules)
- Date verified: 2026-10-17

**Remaining risk**
Long chains of finished days now need one approval each by default (by design).

### F-004: Merging products would fail when the old product had awaiting-release items
- **Severity:** High (a core admin operation breaks with a confusing foreign-key error)
- **Area:** database / code
- **Source:** readiness review (found while checking this session's own changes)
- **Status:** Fixed (verified)
- **Location:** `server/src/services/productMerge.service.ts`

**Reproduction and evidence**
The merge moves four named tables and then `product.delete`s the old product; `pending_releases.productId` is `ON DELETE RESTRICT` (migration `20261017090000`), so the delete would be refused.

**Root cause**
A new table referencing products was not added to the merge's explicit list.

**Fix**
Awaiting-release rows move in the same batch, before the delete; the merge result reports how many.

**Verification**
- Command run: `cd server && npx vitest run`
- Result: 446 passed
- Regression test: `productMerge.service.test.ts` "moves awaiting-release items before deleting the duplicate"
- Date verified: 2026-10-17

**Remaining risk**
Any future table with a product reference has the same trap. Consider a test that fails when the schema gains one that the merge does not list.

### F-005: Month close checked readiness outside the transaction that locks the month
- **Severity:** Medium (an unlock or late save in between could slip into a closed month)
- **Area:** code (concurrency)
- **Source:** readiness review
- **Status:** Fixed (verified)
- **Location:** `server/src/services/monthClose.service.ts` `closeMonth`

**Reproduction and evidence**
`monthReadiness` read through the global client, then a separate transaction created the lock.

**Root cause**
Check-then-act across two transactions.

**Fix**
Readiness and the lock run in one `serializableTransaction`, the pattern the entry saves already use.

**Verification**
- Command run: `cd server && npx vitest run src/services/monthClose.service.test.ts`
- Result: 14 passed
- Regression test: "checks readiness and writes the lock inside one serializable transaction"
- Date verified: 2026-10-17

**Remaining risk**
The race itself was not reproduced; the test proves the structure, not the locking behavior under real concurrency.

### F-006: `/health` discarded the database error
- **Severity:** Medium (a wrong password, an unreachable server and a missing database looked identical and silent)
- **Area:** code (observability)
- **Source:** user report (misleading "database unavailable" message) and review
- **Status:** Fixed (not verified)
- **Location:** `server/src/app.ts`

**Reproduction and evidence**
The route's `catch {}` returned 503 with no log line. During this investigation a Prisma initialization error ("authentication failed for `root`") surfaced to the user only as "the database is unavailable".

**Root cause**
The cause was swallowed at the one endpoint monitors poll.

**Fix**
Logs the error name, Prisma code and last lines of the message, at most once per 30 s (`utils/throttle.ts`). The public response is unchanged.

**Verification**
- Command run: `cd server && npx vitest run`
- Result: 446 passed (throttle unit tests included); type check and lint clean
- Regression test: `throttle.test.ts` covers the gate; the log line in the route is **not** exercised by a test
- Date verified: 2026-10-17

**Remaining risk**
The log statement itself has not been seen firing.

### F-007: Fields and selects had no visible keyboard focus; the focus ring was too faint
- **Severity:** Medium (accessibility)
- **Area:** client CSS
- **Source:** scanner lead, confirmed by reading `index.css`
- **Status:** Fixed (not verified)
- **Location:** `client/src/index.css` (`.ae-input:focus`, new `--ae-focus-ring` token, baseline rule)

**Reproduction and evidence**
`.ae-input:focus` set `outline: none` and left a 0.3 px border and a faint glow; inside the toolbar (borderless, `box-shadow: none !important`) nothing marked focus. The brand gold used for the global ring is about 2.3:1 on white (needs 3:1).

**Root cause**
Focus styling removed the outline without an equivalent replacement.

**Fix**
A `:focus-visible` ring for fields and selects (grid cells keep their own), and a ring token that is darker gold in light mode and bright gold in dark mode.

**Verification**
- Command run: `cd client && npx vitest run src/index.css.test.ts`
- Result: passes (guards that the rules exist)
- Regression test: `index.css.test.ts`
- Date verified: 2026-10-17

**Remaining risk**
Not looked at in a browser; the guard checks the stylesheet text only.

### F-008: A 1.2 MB logo image loaded on every page and in every spinner
- **Severity:** Low (load weight on slow connections)
- **Area:** performance
- **Source:** scanner
- **Status:** Fixed (verified)
- **Location:** `client/public/alaeh-logo-3d-poster.png`

**Reproduction and evidence**
1080x1080 RGBA, 1,218 KB; largest on-screen size in the code is 128 px.

**Fix**
Resized in place to 384x384 (covers 3x screens), transparency kept, same filename.

**Verification**
- Command run: PIL resize, then file size read
- Result: 1,218 KB -> 175 KB, 384x384 RGBA
- Date verified: 2026-10-17

**Remaining risk**
None identified; the original is in git history.

### F-009: React Router advisories (open redirect, constructor injection)
- **Severity:** Medium (moderate per npm; low practical reach here: no server rendering, links are static)
- **Area:** security / dependencies
- **Source:** `npm audit`
- **Status:** Fixed (verified)
- **Location:** `client/package.json`, `package-lock.json`

**Reproduction and evidence**
`npm audit --omit=dev`: 2 moderate (GHSA-wrjc-x8rr-h8h6, GHSA-337j-9hxr-rhxg), range `>=6.0.0 <7.18.0`.

**Fix**
Upgraded `react-router-dom` to 7.18.4. The app uses only stable APIs (HashRouter, Routes, Link, NavLink, useNavigate). The lockfile change adds two small packages and removes `@remix-run/router`. Installed with `--ignore-scripts` because a running process held the Prisma engine file (EPERM).

**Verification**
- Command run: `npm audit --omit=dev`, `cd client && npx tsc -b && npx vitest run && npx vite build`
- Result: moderate advisories gone; type check clean; 553 passed (6 skipped); build OK
- Date verified: 2026-10-17

**Remaining risk**
Routing was not clicked through in a browser. Run `npm install` normally once the dev server is stopped so Prisma's postinstall runs.

### F-010: Prisma command-line tooling advisory (`deepmerge-ts` stack exhaustion)
- **Severity:** High per npm (low practical reach: the tool merges the project's own config, not request data)
- **Area:** security / dependencies
- **Source:** `npm audit`
- **Status:** Accepted risk
- **Location:** `prisma`, `@prisma/config`, `deepmerge-ts`

**Reproduction and evidence**
`npm audit --omit=dev`: 3 high (GHSA-ggr8-5vv4-36mx), fix only via `prisma@7.10.1`.

**Root cause**
Transitive dependency of the Prisma CLI.

**Fix**
Not applied. Prisma 6 to 7 is a major upgrade (new config file, client changes) that needs its own test pass, not a blind bump.

**Verification**
Not applicable.

**Remaining risk**
Open until the Prisma 7 upgrade is done. The CLI runs `migrate deploy` at container start.

### F-011: `.gitignore` gaps
- **Severity:** Low (hardening)
- **Area:** configuration
- **Source:** user request and review
- **Status:** Fixed (verified)
- **Location:** `.gitignore`

**Reproduction and evidence**
Only `.env` and `.env.local` were ignored, so `.env.production`, `.env.docker` and similar were not; dumps, keys, local tool settings and test output had no rule. Git history was checked: only `*.example` templates were ever committed, no real secret.

**Fix**
Added `.env.*` (keeping `!.env.example` and `!.env.*.example`), keys and certs, `*.sql.gz`/`*.dump`/`backups/`, local Claude settings, test and log output, editor and OS files. Deliberately not `*.sql` (the migrations are SQL source).

**Verification**
- Command run: `git ls-files -ci --exclude-standard` and `git check-ignore` on sample paths
- Result: no tracked file is newly ignored; 12 secret/dump/local paths ignored; templates, migrations, `.claude` skills and the product xlsx stay visible
- Date verified: 2026-10-17

**Remaining risk**
None identified.

### F-012: Local MySQL rejects the login in `server/.env`
- **Severity:** High (sign-in impossible)
- **Area:** configuration
- **Source:** user report
- **Status:** Blocked
- **Location:** `server/.env` `DATABASE_URL` (value not recorded here)

**Reproduction and evidence**
A direct Prisma query failed with `PrismaClientInitializationError: Authentication failed against database server, the provided database credentials for root are not valid.` MySQL service `MySQL84` was running on 3306.

**Root cause**
The `root` password in `DATABASE_URL` does not match the server's. The correct value is not available to me.

**Fix**
Needs the real password (or a switch to the Docker database). No password was guessed.

**Verification**
Not applicable until fixed.

**Remaining risk**
Everything database-backed is unexercised here.

### F-013: One extra query per entry save from the month-closed check
- **Severity:** Low
- **Area:** performance
- **Source:** readiness review
- **Status:** Accepted risk
- **Location:** `server/src/services/dayLock.service.ts` `assertMonthOpen`

**Evidence**
`assertPeriodOpen` now also reads `month_closures` (unique key) per save, so Save All of 60 products adds about 60 small reads. Not measured.

**Fix**
Not cached: a stale answer could allow a write into a just-closed month.

**Remaining risk**
Measure if Save All feels slower; a per-request memo is the safe optimization.

### F-014: Quick-jump search box had no focus indicator
- **Severity:** Low
- **Area:** client CSS
- **Source:** scanner lead, confirmed
- **Status:** Fixed (not verified)
- **Location:** `client/src/index.css` `.ae-quickjump-input`

**Fix**
Gold inset underline on keyboard focus.

**Verification**
Type check, lint and the client suite pass; the visual result was not checked.

**Remaining risk**
None identified.

### F-015: Scanner leads that are not defects
- **Severity:** Low
- **Area:** other
- **Source:** scanner
- **Status:** Not reproducible
- **Location:** `copyPrevious.ts:19`, `xlsx.ts:166`, `actionQueue.service.ts:153`, `daysOfStock.service.ts:96`, `dailyReportSnapshot.service.ts:40`; four "unlabeled input" hits; `.ae-extra-head-input` outline

**Evidence**
The five UTC-date hits are deliberate calendar-date arithmetic or labelled-UTC displays. The four inputs sit inside labels or are generic wrappers. `.ae-extra-head-input:focus` has its own 2 px inset style. Logged `console.*` calls are structured startup/error lines or seed scripts.

**Remaining risk**
None identified.

### F-016: No scheduled check that stock chains still add up
- **Severity:** Low (recommendation, not a defect)
- **Area:** code (data integrity)
- **Source:** readiness review
- **Status:** Open
- **Location:** n/a

**Evidence**
Nothing scans for violated invariants (opening != previous closing, transfers that do not mirror). The held-opening requests only cover locked days.

**Remaining risk**
A broken chain is found only when someone notices a figure.

## Remaining risks

| ID | Risk | Severity | Owner | Decision | Deadline |
|---|---|---|---|---|---|
| F-012 | Sign-in blocked by the local database login | High | Project owner | Mitigate (provide the password) | Before any use |
| F-010 | Prisma CLI advisory until Prisma 7 | High (npm) / low reach | Project owner | Defer to a planned upgrade | Next maintenance window |
| F-013 | One extra read per entry save | Low | Project owner | Accept; measure first | When Save All feels slow |
| F-016 | No stock-chain integrity check | Low | Project owner | Defer | Next feature cycle |

## Evidence still needed

- A green CI run, especially the end-to-end job: the first real application of migration `20261017090000_pending_release_month_close` and of the new queries.
- A working database login, to run the whole flow once: finish pending days, release an item, close and unlock a month, approve a correction with and without "apply to later days".
- A backup restore test (not exercised in this review).
- A look at the focus rings, the category fade and the toolbar in a browser.

## Next actions

1. Fix the database login (F-012), restart the server, and run `npm run prisma:migrate:deploy` with the pre-migration snapshot from `PRODUCTION.md`.
2. Stop the dev server, then run a normal `npm install` so Prisma's postinstall runs after the router upgrade.
3. Push and check CI, including the end-to-end job.
4. Plan the Prisma 7 upgrade (F-010).

## Change log

| Date | Change |
|---|---|
| 2026-10-17 | Report created. 16 findings recorded: 11 fixed, 1 blocked, 2 accepted, 1 open, 1 not reproducible. |
