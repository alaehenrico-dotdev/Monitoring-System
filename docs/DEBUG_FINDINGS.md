# Debug Findings Report

**Project:** Ala Eh Stocks Monitoring System
**Scope:** Dead-code and dead-CSS cleanup of `client/src` and `server/src` (files, exports, CSS selectors, keyframes, dependencies, assets).
**Last updated:** 2026-11-16
**Investigator:** Claude
**Progress:** Complete with remaining risks

## Summary

| Severity | Open | In progress | Fixed (not verified) | Fixed (verified) | Accepted risk | Blocked | Not reproducible |
|---|---|---|---|---|---|---|---|
| Critical | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| High | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| Medium | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| Low | 0 | 0 | 0 | 3 | 1 | 0 | 0 |

The only dead code of any size was the old Daily Out bar-and-lines chart (replaced by `FlowLineChart`) and the styles that went with it. It is removed; no behaviour changed. The server has no dead files or dead functions. Nothing here touches audit, count, variance, publishing or stock-math logic.

## Scope and coverage

- **Examined:** all 241 server and 398 client TypeScript files (import graph, exports, files), every CSS file under `client/src` (17 files, ~12,000 lines), `@keyframes`, `package.json` dependencies (root, client, server), image and video assets.
- **Not examined / not provided:** runtime behaviour in a browser (no visual or end-to-end check of the Dashboard and Daily Out pages after the CSS change); the `e2e-browser` Playwright suite was not run; Docker, nginx and Caddy configuration was not checked for dead settings; `prisma/` migrations (history, never removed).
- **Assumptions:** a class name counts as "in use" if production code (not tests) contains it as a string or as the fixed part of a template such as `is-${state}`. Class names assembled in ways a static scan cannot see would be missed in the other direction (see Remaining risks, F-004).
- **Environment for verification:** local Windows machine, Node 26, client built with Vite. The `knip` dead-code tool was not used (the sandbox declined to download it); the analysis uses the project's own TypeScript compiler API instead.

## Findings

### F-001: Unused Daily Out combo chart and its data helpers

- **Severity:** Low (dead weight only; never rendered)
- **Area:** code
- **Source:** import-graph analysis
- **Status:** Fixed (verified)
- **Location:** `client/src/components/ComboChart.tsx`, `client/src/utils/comboChartData.ts`, `dailyOutPoints` and `dayTooltip` in `client/src/utils/dailyOut.ts`

**Reproduction and evidence**
`ComboChart.tsx` had no importer anywhere (git history: added with the first Daily Out commit, later replaced by `FlowLineChart`). `comboChartData.ts` was imported only by it and by `dailyOut.ts`, whose `dailyOutPoints` / `dayTooltip` existed only to feed it; `hasLines` was referenced nowhere. A text search confirmed no other reference (code, CSS, docs, tests other than the one block below).

**Root cause**
The chart was superseded and its pieces were not removed with it.

**Fix**
Deleted the component and `comboChartData.ts`; removed `dailyOutPoints`, `dayTooltip` and the `ComboPoint` / `ComboTooltip` import from `dailyOut.ts`; removed the `dailyOutPoints` test block. `dailyOutFlowPoints` (the live path) is untouched.

**Verification**
- Command run: `npx tsc -b`, `npx eslint src`, `npx vitest run` (in `client/`), `npm run build`
- Result: typecheck and lint clean; 132 files, 1224 tests passed (was 1228: the four removed tests covered only the deleted helper); build succeeds.
- Regression test: existing `dailyOutFlowPoints`, `dailyOutTotals` and `dailyOutCsv` tests still pass.
- Date verified: 2026-11-16

**Remaining risk**
None identified.

### F-002: Dead CSS for the removed chart, and one dead typing style

- **Severity:** Low (about 4.4 kB of shipped CSS)
- **Area:** code (CSS)
- **Source:** CSS class-usage scan
- **Status:** Fixed (verified)
- **Location:** `client/src/styles/shared-base.css` (49 rules, `.ae-mm-*` chart, legend, axis, tooltip and dot styles); `client/src/styles/toolbar-alignment.css` (`.ae-typing-stats--done`)

**Reproduction and evidence**
After F-001, no production code used any of the 49 selectors' classes. `.ae-typing-stats--done` is never set (`TypingPractice` shows results in a dialog now). Kept on purpose, with evidence: `@keyframes ae-mm-tip-in` (still used by `.ae-fl-tip`), the seal-beam states `is-slow` / `is-idle` / `is-connecting` (set by `` `is-${state}` `` in `ActivityBeam`), and the live `.ae-mm-*` classes used by the Period Monitoring card and Daily Out table.

**Root cause**
Same as F-001.

**Fix**
Removed the dead rules (264 lines), left-over comments, and the now-empty reduced-motion block. Built CSS went from 216.49 kB to 212.10 kB (gzip 37.39 to 36.69 kB). A first attempt of the removal script joined neighbouring rules and left an empty `@media`; it was caught in the diff review, discarded, and re-run from the committed text.

**Verification**
- Command run: scan re-run after removal; `npx vitest run`; `npm run build`
- Result: scan reports 0 dead selectors in the cleaned files; 1224 tests passed; build succeeds; diff shows only deletions plus one reformatted selector list.
- Regression test: automated CSS tests (font settings, header styles, menu bar, theme CSS) still pass. **Not verified visually in a browser.**
- Date verified: 2026-11-16

**Remaining risk**
A class applied by a mechanism the scan cannot see would lose its style. The scan treated template-literal and string-built class names as in use, and tests and the build pass, but a visual pass over the Dashboard and Daily Out pages is still recommended.

### F-003: Unused test hook `clearHandoffs`

- **Severity:** Low
- **Area:** code
- **Source:** export analysis
- **Status:** Fixed (verified)
- **Location:** `client/src/utils/searchHandoff.ts`

**Reproduction and evidence**
Exported with the comment "For tests", but no test or production file referenced it.

**Fix**
Removed.

**Verification**
- Command run: `npx tsc -b`, `npx vitest run`
- Result: clean; all tests passed (see F-001).
- Date verified: 2026-11-16

**Remaining risk**
None identified.

### F-004: Exports kept on purpose

- **Severity:** Low
- **Area:** code
- **Source:** export analysis
- **Status:** Accepted risk
- **Location:** server and client modules

**Reproduction and evidence**
The analysis lists many exports with no production importer. They were reviewed and left alone: (a) about 90 exported TypeScript `interface` / `type` declarations that describe public function signatures (no runtime cost, and un-exporting them would break callers' typing); (b) about 100 pure functions exported only so tests can call them directly, each used inside its own file (for example `buildChangeFacts`, `runTool`, `planFinishThrough`); (c) test-support hooks (`resetScheduleState`, `resetAiAvailableCache`, `resetActivity`, `menuTestHelpers`); (d) `localHourToUtc` / `utcHourToLocal` in `driveTime.ts`, small tested building blocks of the slot functions the Drive settings page uses.

**Remaining risk**
Slightly more public surface than strictly needed. Decision: keep.

## Remaining risks

| ID | Risk | Severity | Owner | Decision | Deadline |
|---|---|---|---|---|---|
| F-002 | Visual regression on pages that used the removed styles has not been checked in a browser | Low | Repo owner | Check Dashboard and Daily Out visually before deploying | Before next deploy |
| F-004 | Test-only and type-only exports left in place | Low | Repo owner | Accept | n/a |

## Evidence still needed

- A visual check of the Dashboard and Daily Out pages (light and dark, desktop and phone) after deployment to staging.

## Next actions

1. Look at Dashboard and Daily Out in the browser before deploying.
2. Optional: turn on `noUnusedLocals` in both `tsconfig.json` files. The compiler reported zero unused locals today, so it costs nothing now and stops new ones appearing.
