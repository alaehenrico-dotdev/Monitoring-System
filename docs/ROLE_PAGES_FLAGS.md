# Per-role pages: flags before building

**Project:** Ala Eh Stocks Monitoring System
**Scope:** Adding new operational roles (for example Production, Receiving, Delivery Out), each with its own page, the way the Auditor has one. First step: create the pages only.
**Last updated:** 2026-11-26
**Status:** Review only. No code was changed. Server side and client routing were read; nothing was run.

## Plan this applies to

- Each role owns one movement type and has its own page.
- Entries from a role page feed the matching column on the encoder grid (for example the Production page fills Production (In)).
- The encoder's entries stay open for now.
- The admin keeps access to everything, so the current admin flow does not change.

## How Production is stored today

- `productionIn` is a number on each Online and Offline daily stock row, one row per product, date and shift ([schema.prisma:156](../server/prisma/schema.prisma#L156), [schema.prisma:191](../server/prisma/schema.prisma#L191)).
- Remaining stock is calculated from it.
- Extra amounts ("+1" columns) are stored in `DailyStockExtra` and summed into the same total.
- `PendingRelease` already does something similar: releasing an item adds its quantity to `productionIn` through the normal entry-save path ([pendingRelease.service.ts:125](../server/src/services/pendingRelease.service.ts#L125)). A role page can reuse that pattern.

## Flags

| # | Flag | Severity | Where |
|---|---|---|---|
| 1 | A new role needs a database enum value, so it is not a client-only change | Medium | `schema.prisma:17`, `client/src/types/index.ts:1` |
| 2 | The client route guard only hides pages; the API must enforce access | High | `client/src/App.tsx:146`, `client/src/config/navigation.ts` |
| 3 | A new role would be able to read most server routes by default | High | `server/src/middleware/auth.ts:19-35` |
| 4 | Unknown roles fall back to encoder landing pages and shared menus | Medium | `client/src/config/navigation.ts:14, 139, 144` |
| 5 | Encoder-style checks are hardcoded to named roles | Low | Entry pages, `HeaderExtras`, `Layout`, `QuickJump` |
| 6 | The phone page list is a fixed set of paths | Low | `client/src/config/navigation.ts:102` |
| 7 | Role pages that write stock go through day-lock rules | Medium | Entry save path, `MAX_EXTRAS_PER_COLUMN` |
| 8 | Self-approval of corrections is not blocked | Medium (rises with a second user) | `server/src/services/correction.service.ts:126` |
| 9 | Approving a correction is not one atomic step | Low | `server/src/services/correction.service.ts:131-166` |

### 1. New role = database change

Roles are a Prisma enum (`ENCODER`, `SUPERVISOR_ADMIN`, `AUDITOR`) mirrored in the client `Role` type. A new role means a migration. The user-create endpoint validates against the same enum, so once the enum exists the admin can create the account with no further change.

If the first step is pages only, the pages can be built and shown to the admin first. No real role user can sign in to them until the enum exists.

### 2. Client guards are not a security boundary

`ProtectedRoute allow={[...]}` and the role lists in `navigation.ts` decide what is shown. The server decides what is allowed. A page without matching server permissions will load and then fail on every request.

### 3. Default access for a new role is too wide

Only `AUDITOR` is restricted, by an allowlist (`auditorMayCall`). Many routes require login only, including total stocks, reports, the variance report, cell history and the pending-release lists. Any new role would be able to read them. The comment in `auth.ts` already warns about this.

Before any real role user exists, add a per-role allowlist (or one role-to-routes map) so a role is refused everything not named for it.

### 4. Landing page and menus

- Any role other than the auditor or admin is sent to `/daily-report` (`navigation.ts:139`) and `/online` (`navigation.ts:144`), which are encoder pages. Each new role needs its own home route.
- `ALL_ROLES` lists only `ENCODER` and `SUPERVISOR_ADMIN`, so shared menu entries will not include a new role unless it is added.

### 5. Hardcoded role checks

- The Online and Offline entry pages allow editing for `ENCODER` or `SUPERVISOR_ADMIN` only. A new role is read-only there, which is the right default. The server routes match.
- `HeaderExtras`, `Layout` and `QuickJump` special-case only the auditor, so a new role would get the encoder's calculator, phone note and quick-jump items. What each one exposes was not checked.

### 6. Phone pages

`PHONE_PAGES` is a fixed list of paths. If role users work on phones, their pages must be added.

### 7. Day-lock rules apply to role pages

A Production entry goes through the normal entry save, so a finished period refuses it and days must be finished in order. The page should show a locked state up front.

`MAX_EXTRAS_PER_COLUMN` caps how many added amounts one cell can hold. Its value was not checked. If each batch is stored as one amount, a busy shift could reach the cap.

### 8. Self-approval

`approveCorrection` does not compare the approver with `requestedById`, and any logged-in user can request a correction. It does not matter with one user. It is the gap to close before a second person exists, ideally behind a setting so the single admin is unaffected.

### 9. Correction approval is not atomic

The figure is saved first and the request is marked APPROVED in a later transaction. If the second step fails, the stock has changed while the request stays PENDING. Two admins approving at the same time could both pass the pending check. Low risk with one admin.

## Related findings from the wider review

- Encoders can write manual counts (`manualCounts.routes.ts:31-41`). What those routes do was not read. If they enter or edit counts, check that the blind auditor count stays the independent source.
- Negative stock is allowed on save and only settled when the day is finished.
- The stock drift check covers the last 7 days and caps at 200 rows.

## Double-count risk

The encoder can still type into the same column a role page feeds. The "+1" breakdown shows each amount, but both sides could enter the same stock. Decide which one is the source for each column, or add a visible source tag on each amount.

## Suggested order

1. Server: role-to-routes allowlist (flag 3) and the enum migration (flag 1), tested on a copy of the database.
2. Client: role pages, home route, menu entries and phone pages (flags 4 to 6).
3. Production page feeding `productionIn` through the existing entry-save path, with a locked state (flag 7).
4. Self-approval setting (flag 8) before adding a second real user.

## Not checked

- The value of `MAX_EXTRAS_PER_COLUMN`.
- What `QuickJump` and `HeaderExtras` expose for the role-specific items.
- Whether existing tests (for example `auth.test.ts`) assert the three-role assumption.
- Test results, the build, and the uncommitted change-log work in the working tree.
